import { supabaseAdmin } from "./supabase.js";

export type DbList = {
  id: string;
  owner_id: string;
  name: string;
  position: number;
  share_token: string | null;
  share_password_hash: string | null;
  share_enabled: boolean;
  updated_at_ms: number;
  deleted: boolean;
};

export type DbItem = {
  id: string;
  list_id: string;
  name: string;
  quantity: string;
  checked: boolean;
  position: number;
  updated_at_ms: number;
  deleted: boolean;
};

export type WireItem = {
  id: string;
  name: string;
  quantity: string;
  checked: boolean;
  position: number;
  updatedAt: number;
  deleted: boolean;
};

export type WireList = {
  id: string;
  name: string;
  position: number;
  updatedAt: number;
  deleted: boolean;
  items: WireItem[];
};

export function dbListToWire(list: DbList, items: DbItem[]): WireList {
  return {
    id: list.id,
    name: list.name,
    position: list.position,
    updatedAt: Number(list.updated_at_ms),
    deleted: list.deleted,
    items: items
      .filter((it) => it.list_id === list.id)
      .map(dbItemToWire),
  };
}

export function dbItemToWire(item: DbItem): WireItem {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    checked: item.checked,
    position: item.position,
    updatedAt: Number(item.updated_at_ms),
    deleted: item.deleted,
  };
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

export async function getListsForUser(userId: string): Promise<WireList[]> {
  const { data: lists, error: lerr } = await supabaseAdmin
    .from("lists")
    .select("*")
    .eq("owner_id", userId);
  if (lerr) throw lerr;
  if (!lists || lists.length === 0) return [];

  const ids = lists.map((l) => l.id);
  const { data: items, error: ierr } = await supabaseAdmin
    .from("items")
    .select("*")
    .in("list_id", ids);
  if (ierr) throw ierr;

  return (lists as DbList[]).map((l) => dbListToWire(l, (items as DbItem[]) ?? []));
}

export async function getListById(listId: string): Promise<WireList | null> {
  const { data: list, error: lerr } = await supabaseAdmin
    .from("lists")
    .select("*")
    .eq("id", listId)
    .maybeSingle();
  if (lerr) throw lerr;
  if (!list) return null;

  const { data: items, error: ierr } = await supabaseAdmin
    .from("items")
    .select("*")
    .eq("list_id", listId);
  if (ierr) throw ierr;

  return dbListToWire(list as DbList, (items as DbItem[]) ?? []);
}

export async function getRawListById(listId: string): Promise<DbList | null> {
  const { data, error } = await supabaseAdmin
    .from("lists")
    .select("*")
    .eq("id", listId)
    .maybeSingle();
  if (error) throw error;
  return (data as DbList) ?? null;
}

export async function getRawListByShareToken(
  shareToken: string
): Promise<DbList | null> {
  const { data, error } = await supabaseAdmin
    .from("lists")
    .select("*")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (error) throw error;
  return (data as DbList) ?? null;
}

export async function userServerVersion(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("user_server_version", {
    uid: userId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function listServerVersion(listId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("list_server_version", {
    lid: listId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

// ---------------------------------------------------------------------
// Upserts (last-writer-wins per row by updatedAt)
// ---------------------------------------------------------------------

type IncomingItem = {
  id: string;
  name?: string;
  quantity?: string;
  checked?: boolean;
  position?: number;
  updatedAt: number;
  deleted?: boolean;
};

type IncomingList = {
  id: string;
  name?: string;
  position?: number;
  updatedAt: number;
  deleted?: boolean;
  items?: IncomingItem[];
};

type UpsertScope =
  | { kind: "user"; userId: string }
  | { kind: "guest"; listId: string };

export async function applyClientChanges(
  scope: UpsertScope,
  incoming: IncomingList[]
): Promise<WireList[]> {
  const merged: WireList[] = [];

  for (const inc of incoming) {
    if (!inc?.id || typeof inc.updatedAt !== "number") continue;

    // Scope guard: a guest can only touch their authorised list.
    if (scope.kind === "guest" && inc.id !== scope.listId) continue;

    const existing = await getRawListById(inc.id);

    if (!existing) {
      // Guests can never create new lists.
      if (scope.kind === "guest") continue;
      const created = await insertList(scope.userId, inc);
      const items = await replaceItems(inc.id, inc.items ?? [], scope);
      merged.push(dbListToWire(created, items));
      continue;
    }

    // Scope guard: a user can only touch their own lists.
    if (scope.kind === "user" && existing.owner_id !== scope.userId) continue;

    const listIsNewer = inc.updatedAt >= existing.updated_at_ms;
    const updated: DbList = listIsNewer
      ? await updateList(existing, inc, scope.kind === "guest")
      : existing;

    const items = await mergeItems(inc.id, inc.items ?? []);
    merged.push(dbListToWire(updated, items));
  }

  return merged;
}

async function insertList(
  ownerId: string,
  inc: IncomingList
): Promise<DbList> {
  const row = {
    id: inc.id,
    owner_id: ownerId,
    name: inc.name ?? "Untitled list",
    position: inc.position ?? 0,
    updated_at_ms: inc.updatedAt,
    deleted: inc.deleted ?? false,
  };
  const { data, error } = await supabaseAdmin
    .from("lists")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as DbList;
}

async function updateList(
  existing: DbList,
  inc: IncomingList,
  guest: boolean
): Promise<DbList> {
  // Guests must never delete lists or change ownership/sharing fields.
  const patch: Partial<DbList> = {
    name: inc.name ?? existing.name,
    position: inc.position ?? existing.position,
    deleted: guest ? existing.deleted : inc.deleted ?? existing.deleted,
    updated_at_ms: inc.updatedAt,
  };
  const { data, error } = await supabaseAdmin
    .from("lists")
    .update(patch)
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as DbList;
}

async function replaceItems(
  listId: string,
  incoming: IncomingItem[],
  _scope: UpsertScope
): Promise<DbItem[]> {
  if (incoming.length === 0) return [];
  const rows = incoming.map((it) => ({
    id: it.id,
    list_id: listId,
    name: it.name ?? "",
    quantity: it.quantity ?? "",
    checked: it.checked ?? false,
    position: it.position ?? 0,
    updated_at_ms: it.updatedAt,
    deleted: it.deleted ?? false,
  }));
  const { data, error } = await supabaseAdmin
    .from("items")
    .upsert(rows, { onConflict: "id" })
    .select("*");
  if (error) throw error;
  return (data as DbItem[]) ?? [];
}

async function mergeItems(
  listId: string,
  incoming: IncomingItem[]
): Promise<DbItem[]> {
  if (incoming.length === 0) {
    const { data, error } = await supabaseAdmin
      .from("items")
      .select("*")
      .eq("list_id", listId);
    if (error) throw error;
    return (data as DbItem[]) ?? [];
  }

  const ids = incoming.map((i) => i.id);
  const { data: existing, error: lerr } = await supabaseAdmin
    .from("items")
    .select("*")
    .in("id", ids);
  if (lerr) throw lerr;
  const byId = new Map<string, DbItem>(
    ((existing as DbItem[]) ?? []).map((i) => [i.id, i])
  );

  const winners = incoming
    .filter((inc) => {
      const cur = byId.get(inc.id);
      return !cur || inc.updatedAt >= Number(cur.updated_at_ms);
    })
    .map((inc) => {
      const cur = byId.get(inc.id);
      return {
        id: inc.id,
        list_id: listId,
        name: inc.name ?? cur?.name ?? "",
        quantity: inc.quantity ?? cur?.quantity ?? "",
        checked: inc.checked ?? cur?.checked ?? false,
        position: inc.position ?? cur?.position ?? 0,
        updated_at_ms: inc.updatedAt,
        deleted: inc.deleted ?? cur?.deleted ?? false,
      };
    });

  if (winners.length > 0) {
    const { error } = await supabaseAdmin
      .from("items")
      .upsert(winners, { onConflict: "id" });
    if (error) throw error;
  }

  const { data: final, error: ferr } = await supabaseAdmin
    .from("items")
    .select("*")
    .eq("list_id", listId);
  if (ferr) throw ferr;
  return (final as DbItem[]) ?? [];
}
