import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env.js";

// Service-role client: bypasses RLS, used for everything the BFF does on
// behalf of an authenticated user (read/write lists & items, manage
// users via auth.admin).
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// Anon client: only used to call signInWithPassword / refreshSession on
// behalf of users (those flows want the regular auth API, not the admin
// API). It still hits the same local GoTrue.
export const supabaseAuth: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export async function pingSupabase(): Promise<{ ok: boolean; message?: string }> {
  try {
    const { error } = await supabaseAdmin.from("profiles").select("user_id").limit(1);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
