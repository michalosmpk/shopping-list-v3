import { supabaseAdmin, supabaseAuth } from "./supabase.js";
import { env } from "../env.js";

const NAME_RE = /^[a-z0-9._-]{2,32}$/;

export type UserRow = {
  user_id: string;
  name: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
};

export function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

export function nameToEmail(name: string): string {
  return `${normalizeName(name)}@${env.EMAIL_DOMAIN}`;
}

export async function listUsers(): Promise<UserRow[]> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as UserRow[]) ?? [];
}

export async function getProfileByName(
  name: string
): Promise<UserRow | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("name", normalizeName(name))
    .maybeSingle();
  if (error) throw error;
  return (data as UserRow) ?? null;
}

export async function getProfileByUserId(
  userId: string
): Promise<UserRow | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as UserRow) ?? null;
}

export async function countAdmins(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("is_admin", true);
  if (error) throw error;
  return count ?? 0;
}

export async function createUser(opts: {
  name: string;
  displayName?: string;
  password: string;
  isAdmin?: boolean;
}): Promise<UserRow> {
  const name = normalizeName(opts.name);
  if (!isValidName(name)) {
    throw Object.assign(new Error("invalid_name"), { status: 400 });
  }
  if (opts.password.length < 6) {
    throw Object.assign(new Error("password_too_short"), { status: 400 });
  }

  const existing = await getProfileByName(name);
  if (existing) {
    throw Object.assign(new Error("name_taken"), { status: 409 });
  }

  // Step 1: create the auth user (synthetic email, pre-confirmed so they
  // can log in immediately without any confirmation flow).
  const { data: created, error: cerr } = await supabaseAdmin.auth.admin.createUser({
    email: nameToEmail(name),
    password: opts.password,
    email_confirm: true,
    user_metadata: { name, display_name: opts.displayName ?? name },
  });
  if (cerr || !created.user) {
    throw Object.assign(new Error(cerr?.message ?? "create_user_failed"), {
      status: 500,
    });
  }

  // Step 2: persist the profile row (name + admin flag).
  const { data: profile, error: perr } = await supabaseAdmin
    .from("profiles")
    .insert({
      user_id: created.user.id,
      name,
      display_name: opts.displayName ?? name,
      is_admin: Boolean(opts.isAdmin),
    })
    .select("*")
    .single();
  if (perr) {
    // Roll back the auth user so we don't leave an orphan around.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    throw Object.assign(new Error(perr.message), { status: 500 });
  }
  return profile as UserRow;
}

export async function deleteUser(userId: string): Promise<void> {
  // FK on profiles cascades when auth.users row is dropped; deleting the
  // auth user also revokes outstanding tokens.
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    throw Object.assign(new Error(error.message), { status: 500 });
  }
}

export async function setUserAdmin(
  userId: string,
  isAdmin: boolean
): Promise<UserRow> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update({ is_admin: isAdmin })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message), { status: 500 });
  }
  return data as UserRow;
}

export async function signInWithName(opts: {
  name: string;
  password: string;
}) {
  const email = nameToEmail(opts.name);
  return supabaseAuth.auth.signInWithPassword({ email, password: opts.password });
}

export async function refreshSession(refreshToken: string) {
  return supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
}

export async function bootstrapAdminIfNeeded(): Promise<void> {
  if (!env.ADMIN_BOOTSTRAP_NAME || !env.ADMIN_BOOTSTRAP_PASSWORD) return;
  const admins = await countAdmins();
  if (admins > 0) return;
  const name = normalizeName(env.ADMIN_BOOTSTRAP_NAME);
  if (!isValidName(name)) {
    console.warn(`[bootstrap] ADMIN_BOOTSTRAP_NAME "${name}" is invalid, skipping`);
    return;
  }
  const existing = await getProfileByName(name);
  if (existing) {
    // Promote whoever owns that name to admin.
    if (!existing.is_admin) {
      await setUserAdmin(existing.user_id, true);
      console.log(`[bootstrap] promoted existing user "${name}" to admin`);
    }
    return;
  }
  await createUser({
    name,
    password: env.ADMIN_BOOTSTRAP_PASSWORD,
    isAdmin: true,
  });
  console.log(`[bootstrap] created initial admin "${name}"`);
}
