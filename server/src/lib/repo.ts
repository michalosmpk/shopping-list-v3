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

export type DbListMember = {
  list_id: string;
  user_id: string;
  position: number;
  created_at: string;
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
  // Audience-aware metadata so the client can render owner-only
  // affordances (Share, Delete) appropriately.
  ownerId: string;
  ownerName?: string;
  isOwner: boolean;
  items: WireItem[];
};

function shapeWire(opts: {
  list: DbList;
  position: number;
  isOwner: boolean;
  ownerName?: string;
  items: DbItem[];
}): WireList {
  return {
    id: opts.list.id,
    name: opts.list.name,
    position: opts.position,
    updatedAt: Number(opts.list.updated_at_ms),
    deleted: opts.list.deleted,
    ownerId: opts.list.owner_id,
    ownerName: opts.ownerName,
    isOwner: opts.isOwner,
    items: opts.items
      .filter((it) => it.list_id === opts.list.id)
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

async function getOwnerNamesByIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, display_name, name")
    .in("user_id", Array.from(new Set(ids)));
  if (error) throw error;
  for (const row of data ?? []) {
    const r = row as { user_id: string; display_name: string; name: string };
    out.set(r.user_id, r.display_name || r.name);
  }
  return out;
}

export async function getListsForUser(userId: string): Promise<WireList[]> {
  // Lists this user owns.
  const { data: owned, error: oerr } = await supabaseAdmin
    .from("lists")
    .select("*")
    .eq("owner_id", userId);
  if (oerr) throw oerr;

  // Lists this user is a member of (with their personal position).
  const { data: memberships, error: merr } = await supabaseAdmin
    .from("list_members")
    .select("list_id, position")
    .eq("user_id", userId);
  if (merr) throw merr;
  const memberMap = new Map<string, number>(
    ((memberships as { list_id: string; position: number }[]) ?? []).map(
      (m) => [m.list_id, m.position]
    )
  );

  let sharedLists: DbList[] = [];
  if (memberMap.size > 0) {
    const { data, error } = await supabaseAdmin
      .from("lists")
      .select("*")
      .in("id", Array.from(memberMap.keys()))
      .eq("deleted", false);
    if (error) throw error;
    sharedLists = (data as DbList[]) ?? [];
  }

  const allLists: DbList[] = [...((owned as DbList[]) ?? []), ...sharedLists];
  if (allLists.length === 0) return [];

  // Fetch every item once, group by list.
  const ids = allLists.map((l) => l.id);
  const { data: items, error: ierr } = await supabaseAdmin
    .from("items")
    .select("*")
    .in("list_id", ids);
  if (ierr) throw ierr;

  const ownerNames = await getOwnerNamesByIds(allLists.map((l) => l.owner_id));

  return allLists.map((l) => {
    const isOwner = l.owner_id === userId;
    const position = isOwner ? l.position : memberMap.get(l.id) ?? 0;
    return shapeWire({
      list: l,
      position,
      isOwner,
      ownerName: ownerNames.get(l.owner_id),
      items: (items as DbItem[]) ?? [],
    });
  });
}

export async function getListByIdForUser(
  listId: string,
  userId: string
): Promise<WireList | null> {
  const list = await getRawListById(listId);
  if (!list || list.deleted) return null;
  const isOwner = list.owner_id === userId;
  let position = list.position;
  if (!isOwner) {
    const member = await getMembership(listId, userId);
    if (!member) return null;
    position = member.position;
  }
  const { data: items, error } = await supabaseAdmin
    .from("items")
    .select("*")
    .eq("list_id", listId);
  if (error) throw error;
  const ownerNames = await getOwnerNamesByIds([list.owner_id]);
  return shapeWire({
    list,
    position,
    isOwner,
    ownerName: ownerNames.get(list.owner_id),
    items: (items as DbItem[]) ?? [],
  });
}

export async function getListByIdForGuest(
  listId: string
): Promise<WireList | null> {
  const list = await getRawListById(listId);
  if (!list || list.deleted) return null;
  const { data: items, error } = await supabaseAdmin
    .from("items")
    .select("*")
    .eq("list_id", listId);
  if (error) throw error;
  return shapeWire({
    list,
    position: list.position,
    isOwner: false,
    items: (items as DbItem[]) ?? [],
  });
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

export async function getMembership(
  listId: string,
  userId: string
): Promise<DbListMember | null> {
  const { data, error } = await supabaseAdmin
    .from("list_members")
    .select("*")
    .eq("list_id", listId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as DbListMember) ?? null;
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
// Membership management
// ---------------------------------------------------------------------

export type MemberWithProfile = {
  user_id: string;
  position: number;
  created_at: string;
  profiles: { name: string; display_name: string; is_admin: boolean };
};

export async function listMembersWithProfiles(
  listId: string
): Promise<MemberWithProfile[]> {
  // Two-step join: PostgREST embedding can't express this since both
  // list_members.user_id and profiles.user_id reference auth.users.id
  // without a direct FK between the two public tables.
  const { data: members, error: merr } = await supabaseAdmin
    .from("list_members")
    .select("user_id, position, created_at")
    .eq("list_id", listId)
    .order("created_at", { ascending: true });
  if (merr) throw merr;
  const ids = ((members as { user_id: string }[]) ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];
  const { data: profiles, error: perr } = await supabaseAdmin
    .from("profiles")
    .select("user_id, name, display_name, is_admin")
    .in("user_id", ids);
  if (perr) throw perr;
  const byId = new Map<string, { name: string; display_name: string; is_admin: boolean }>(
    ((profiles as Array<{
      user_id: string;
      name: string;
      display_name: string;
      is_admin: boolean;
    }>) ?? []).map((p) => [p.user_id, p])
  );
  return ((members as Array<{
    user_id: string;
    position: number;
    created_at: string;
  }>) ?? []).map((m) => ({
    user_id: m.user_id,
    position: m.position,
    created_at: m.created_at,
    profiles: byId.get(m.user_id) ?? {
      name: "(unknown)",
      display_name: "(unknown)",
      is_admin: false,
    },
  }));
}

export async function nextMemberPosition(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("list_members")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return ((data as { position?: number } | null)?.position ?? 0) + 1;
}

export async function addMembership(
  listId: string,
  userId: string
): Promise<void> {
  const position = await nextMemberPosition(userId);
  const { error } = await supabaseAdmin
    .from("list_members")
    .insert({ list_id: listId, user_id: userId, position });
  if (error && error.code !== "23505") throw error; // 23505 = unique violation = already a member
}

export async function removeMembership(
  listId: string,
  userId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("list_members")
    .delete()
    .eq("list_id", listId)
    .eq("user_id", userId);
  if (error) throw error;
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

    if (scope.kind === "guest" && inc.id !== scope.listId) continue;

    const existing = await getRawListById(inc.id);

    if (!existing) {
      if (scope.kind !== "user") continue;
      const created = await insertList(scope.userId, inc);
      const items = await mergeItems(inc.id, inc.items ?? []);
      const ownerNames = await getOwnerNamesByIds([scope.userId]);
      merged.push(
        shapeWire({
          list: created,
          position: created.position,
          isOwner: true,
          ownerName: ownerNames.get(scope.userId),
          items,
        })
      );
      continue;
    }

    // Authorisation: who is this caller relative to the list?
    let role: "owner" | "member" | "guest";
    let memberPosition = 0;
    if (scope.kind === "guest") {
      role = "guest";
    } else if (existing.owner_id === scope.userId) {
      role = "owner";
    } else {
      const member = await getMembership(existing.id, scope.userId);
      if (!member) continue; // user has no business touching this list
      role = "member";
      memberPosition = member.position;
    }

    // "Delete" semantics depend on role:
    //   owner  → soft-delete the whole list (and any items in payload)
    //   member → leave the share (no list deletion, items ignored)
    //   guest  → ignored
    if (inc.deleted === true) {
      if (role === "owner") {
        const updated = await updateOwnedList(existing, inc, /* allowDelete */ true);
        // Cascade: also persist the soft-deletes the client sent for
        // this list's items so other clients pick them up.
        const items = await mergeItems(inc.id, inc.items ?? []);
        const ownerNames = await getOwnerNamesByIds([updated.owner_id]);
        merged.push(
          shapeWire({
            list: updated,
            position: updated.position,
            isOwner: true,
            ownerName: ownerNames.get(updated.owner_id),
            items,
          })
        );
        continue;
      }
      if (role === "member" && scope.kind === "user") {
        await removeMembership(existing.id, scope.userId);
        merged.push(
          shapeWire({
            list: { ...existing, deleted: true, updated_at_ms: inc.updatedAt },
            position: memberPosition,
            isOwner: false,
            items: [],
          })
        );
        continue;
      }
      // guest delete attempt → fall through, ignored as a list-level update
    }

    // Non-delete updates.
    if (role === "owner") {
      const listIsNewer = inc.updatedAt >= existing.updated_at_ms;
      const updated: DbList = listIsNewer
        ? await updateOwnedList(existing, inc, /* allowDelete */ true)
        : existing;
      const items = await mergeItems(inc.id, inc.items ?? []);
      const ownerNames = await getOwnerNamesByIds([updated.owner_id]);
      merged.push(
        shapeWire({
          list: updated,
          position: updated.position,
          isOwner: true,
          ownerName: ownerNames.get(updated.owner_id),
          items,
        })
      );
      continue;
    }

    if (role === "member" && scope.kind === "user") {
      // Member can rename and edit items; their position is per-user.
      const listIsNewer = inc.updatedAt >= existing.updated_at_ms;
      const renamed = listIsNewer && inc.name && inc.name !== existing.name;
      const newName = renamed ? inc.name! : existing.name;
      const finalList = renamed
        ? await touchListName(existing.id, newName, inc.updatedAt)
        : existing;
      let pos = memberPosition;
      if (typeof inc.position === "number" && inc.position !== memberPosition) {
        pos = await updateMemberPosition(existing.id, scope.userId, inc.position);
      }
      const items = await mergeItems(inc.id, inc.items ?? []);
      const ownerNames = await getOwnerNamesByIds([finalList.owner_id]);
      merged.push(
        shapeWire({
          list: finalList,
          position: pos,
          isOwner: false,
          ownerName: ownerNames.get(finalList.owner_id),
          items,
        })
      );
      continue;
    }

    if (role === "guest") {
      // Guests: same as before — never change list metadata, only items.
      const items = await mergeItems(inc.id, inc.items ?? []);
      merged.push(
        shapeWire({
          list: existing,
          position: existing.position,
          isOwner: false,
          items,
        })
      );
      continue;
    }
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

async function updateOwnedList(
  existing: DbList,
  inc: IncomingList,
  allowDelete: boolean
): Promise<DbList> {
  const patch: Partial<DbList> = {
    name: inc.name ?? existing.name,
    position: inc.position ?? existing.position,
    deleted: allowDelete ? inc.deleted ?? existing.deleted : existing.deleted,
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

async function touchListName(
  listId: string,
  name: string,
  updatedAt: number
): Promise<DbList> {
  const { data, error } = await supabaseAdmin
    .from("lists")
    .update({ name, updated_at_ms: updatedAt })
    .eq("id", listId)
    .select("*")
    .single();
  if (error) throw error;
  return data as DbList;
}

async function updateMemberPosition(
  listId: string,
  userId: string,
  position: number
): Promise<number> {
  const { error } = await supabaseAdmin
    .from("list_members")
    .update({ position })
    .eq("list_id", listId)
    .eq("user_id", userId);
  if (error) throw error;
  return position;
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
