import { supabaseAdmin } from "./supabase.js";

export type DbPreset = {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
};

export type DbPresetItem = {
  id: string;
  preset_id: string;
  name: string;
  quantity: string;
  position: number;
};

type ProfileBits = {
  user_id: string;
  name: string;
  display_name: string;
};

export type PresetMemberView = {
  id: string;
  name: string;
  displayName: string;
};

export type PresetView = {
  id: string;
  name: string;
  isOwner: boolean;
  ownerName: string;
  ownerDisplayName: string;
  items: Array<{ name: string; quantity: string }>;
  members: PresetMemberView[];
};

const NAME_MAX = 80;
const ITEM_NAME_MAX = 200;
const ITEM_QTY_MAX = 40;
const ITEM_CAP = 200;

export function parsePresetInput(body: unknown):
  | { name: string; items: Array<{ name: string; quantity: string }> }
  | { error: string } {
  const raw = (body ?? {}) as { name?: unknown; items?: unknown };
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return { error: "Name the preset first." };
  }
  const name = raw.name.trim();
  if (name.length > NAME_MAX) {
    return { error: `Preset name must be ${NAME_MAX} characters or fewer.` };
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    return { error: "Pick at least one item." };
  }
  if (raw.items.length > ITEM_CAP) {
    return { error: `A preset can hold at most ${ITEM_CAP} items.` };
  }
  const items: Array<{ name: string; quantity: string }> = [];
  for (const entry of raw.items) {
    const row = entry as { name?: unknown; quantity?: unknown };
    if (typeof row.name !== "string" || !row.name.trim()) {
      return { error: "Every selected item needs a name." };
    }
    const itemName = row.name.trim();
    if (itemName.length > ITEM_NAME_MAX) {
      return { error: "One of the item names is too long." };
    }
    const quantity =
      typeof row.quantity === "string" ? row.quantity.trim() : "";
    if (quantity.length > ITEM_QTY_MAX) {
      return { error: "One of the quantities is too long." };
    }
    items.push({ name: itemName, quantity });
  }
  return { name, items };
}

async function profilesByIds(ids: string[]): Promise<Map<string, ProfileBits>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, name, display_name")
    .in("user_id", unique);
  if (error) throw error;
  return new Map(
    ((data as ProfileBits[]) ?? []).map((p) => [p.user_id, p])
  );
}

function unknownProfile(): ProfileBits {
  return {
    user_id: "",
    name: "(unknown)",
    display_name: "(unknown)",
  };
}

export async function getPreset(id: string): Promise<DbPreset | null> {
  const { data, error } = await supabaseAdmin
    .from("presets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as DbPreset) ?? null;
}

export async function isPresetMember(
  presetId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("preset_members")
    .select("user_id")
    .eq("preset_id", presetId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function itemsFor(presetIds: string[]): Promise<Map<string, DbPresetItem[]>> {
  const grouped = new Map<string, DbPresetItem[]>();
  if (presetIds.length === 0) return grouped;
  const { data, error } = await supabaseAdmin
    .from("preset_items")
    .select("*")
    .in("preset_id", presetIds)
    .order("position", { ascending: true });
  if (error) throw error;
  for (const item of (data as DbPresetItem[]) ?? []) {
    const list = grouped.get(item.preset_id) ?? [];
    list.push(item);
    grouped.set(item.preset_id, list);
  }
  return grouped;
}

async function membersFor(
  presetIds: string[]
): Promise<Map<string, PresetMemberView[]>> {
  const grouped = new Map<string, PresetMemberView[]>();
  if (presetIds.length === 0) return grouped;
  const { data, error } = await supabaseAdmin
    .from("preset_members")
    .select("preset_id, user_id, created_at")
    .in("preset_id", presetIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows =
    (data as Array<{ preset_id: string; user_id: string; created_at: string }>) ??
    [];
  const profiles = await profilesByIds(rows.map((r) => r.user_id));
  for (const row of rows) {
    const profile = profiles.get(row.user_id) ?? unknownProfile();
    const list = grouped.get(row.preset_id) ?? [];
    list.push({
      id: row.user_id,
      name: profile.name,
      displayName: profile.display_name,
    });
    grouped.set(row.preset_id, list);
  }
  return grouped;
}

function toView(
  preset: DbPreset,
  userId: string,
  profiles: Map<string, ProfileBits>,
  items: DbPresetItem[],
  members: PresetMemberView[]
): PresetView {
  const owner = profiles.get(preset.owner_id) ?? unknownProfile();
  const isOwner = preset.owner_id === userId;
  return {
    id: preset.id,
    name: preset.name,
    isOwner,
    ownerName: owner.name,
    ownerDisplayName: owner.display_name,
    items: items.map((item) => ({ name: item.name, quantity: item.quantity })),
    // Membership is an owner concern. Shared users only need the items.
    members: isOwner ? members : [],
  };
}

export async function listPresetsForUser(userId: string): Promise<PresetView[]> {
  const { data: ownedRows, error: ownedErr } = await supabaseAdmin
    .from("presets")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  if (ownedErr) throw ownedErr;
  const owned = (ownedRows as DbPreset[]) ?? [];

  const { data: memberships, error: memErr } = await supabaseAdmin
    .from("preset_members")
    .select("preset_id")
    .eq("user_id", userId);
  if (memErr) throw memErr;
  const ownedIds = new Set(owned.map((p) => p.id));
  const sharedIds = ((memberships as { preset_id: string }[]) ?? [])
    .map((m) => m.preset_id)
    .filter((id) => !ownedIds.has(id));

  let shared: DbPreset[] = [];
  if (sharedIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("presets")
      .select("*")
      .in("id", sharedIds);
    if (error) throw error;
    shared = ((data as DbPreset[]) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  const all = [...owned, ...shared];
  if (all.length === 0) return [];

  const [itemsByPreset, membersByPreset, profiles] = await Promise.all([
    itemsFor(all.map((p) => p.id)),
    membersFor(owned.map((p) => p.id)),
    profilesByIds(all.map((p) => p.owner_id)),
  ]);

  return all.map((preset) =>
    toView(
      preset,
      userId,
      profiles,
      itemsByPreset.get(preset.id) ?? [],
      membersByPreset.get(preset.id) ?? []
    )
  );
}

export async function createPreset(
  ownerId: string,
  name: string,
  items: Array<{ name: string; quantity: string }>
): Promise<PresetView> {
  const id = crypto.randomUUID();
  const { error } = await supabaseAdmin.from("presets").insert({
    id,
    owner_id: ownerId,
    name,
  });
  if (error) throw error;

  const rows = items.map((item, index) => ({
    id: crypto.randomUUID(),
    preset_id: id,
    name: item.name,
    quantity: item.quantity,
    position: index,
  }));
  const { error: itemErr } = await supabaseAdmin
    .from("preset_items")
    .insert(rows);
  if (itemErr) {
    await supabaseAdmin.from("presets").delete().eq("id", id);
    throw itemErr;
  }

  const profile = (await profilesByIds([ownerId])).get(ownerId) ?? unknownProfile();
  return {
    id,
    name,
    isOwner: true,
    ownerName: profile.name,
    ownerDisplayName: profile.display_name,
    items,
    members: [],
  };
}

export async function deletePreset(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("presets").delete().eq("id", id);
  if (error) throw error;
}

export async function addPresetMember(
  presetId: string,
  userId: string
): Promise<void> {
  const { error } = await supabaseAdmin.from("preset_members").insert({
    preset_id: presetId,
    user_id: userId,
  });
  if (error) throw error;
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export async function removePresetMember(
  presetId: string,
  userId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("preset_members")
    .delete()
    .eq("preset_id", presetId)
    .eq("user_id", userId);
  if (error) throw error;
}
