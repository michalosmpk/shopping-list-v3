import { db, getMeta, setMeta } from "../db/local";
import { api } from "../api";
import type { ShoppingItem, ShoppingList, SyncListPayload } from "../types";

const LAST_PULL_KEY = "lastPullAt";
const SERVER_VERSION_KEY = "lastServerVersion";

export type SyncResult =
  | { ok: true; pushed: number; pulled: number }
  | { ok: false; reason: "offline" | "auth" | "error"; message?: string };

export type HeartbeatResult =
  | {
      ok: true;
      changed: boolean;
      serverVersion: number;
      lastVersion: number;
    }
  | { ok: false; reason: "offline" | "auth" | "error"; message?: string };

export async function getLastServerVersion(): Promise<number> {
  return (await getMeta<number>(SERVER_VERSION_KEY)) ?? 0;
}

export async function checkHeartbeat(): Promise<HeartbeatResult> {
  if (!navigator.onLine) return { ok: false, reason: "offline" };
  try {
    const res = await api.heartbeat();
    const lastVersion = await getLastServerVersion();
    return {
      ok: true,
      changed: res.serverVersion !== lastVersion,
      serverVersion: res.serverVersion,
      lastVersion,
    };
  } catch (err) {
    if (err instanceof api.HttpError && err.status === 401) {
      return { ok: false, reason: "auth", message: err.message };
    }
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function buildPushPayload(): Promise<SyncListPayload[]> {
  const dirtyLists = await db.lists.where("dirty").above(0).toArray();
  const dirtyItems = await db.items.where("dirty").above(0).toArray();

  // Group dirty items by listId.
  const itemsByList = new Map<string, ShoppingItem[]>();
  for (const it of dirtyItems) {
    const arr = itemsByList.get(it.listId) ?? [];
    arr.push(it);
    itemsByList.set(it.listId, arr);
  }

  const listIds = new Set<string>(dirtyLists.map((l) => l.id));
  for (const id of itemsByList.keys()) listIds.add(id);

  const payload: SyncListPayload[] = [];
  for (const id of listIds) {
    let list = dirtyLists.find((l) => l.id === id);
    if (!list) list = await db.lists.get(id);
    if (!list) continue;

    payload.push({
      id: list.id,
      name: list.name,
      position: list.position,
      updatedAt: list.updatedAt,
      deleted: list.deleted,
      items: (itemsByList.get(id) ?? []).map((it) => ({
        id: it.id,
        name: it.name,
        quantity: it.quantity,
        checked: it.checked,
        position: it.position,
        updatedAt: it.updatedAt,
        deleted: it.deleted,
      })),
    });
  }
  return payload;
}

async function applyServerLists(serverLists: SyncListPayload[]): Promise<void> {
  await db.transaction("rw", db.lists, db.items, async () => {
    for (const sl of serverLists) {
      const existing = await db.lists.get(sl.id);
      const localIsNewer =
        existing && (existing.updatedAt ?? 0) > (sl.updatedAt ?? 0) && existing.dirty > 0;

      if (!existing) {
        const newList: ShoppingList = {
          id: sl.id,
          name: sl.name,
          position: sl.position,
          updatedAt: sl.updatedAt,
          deleted: sl.deleted,
          dirty: 0,
        };
        await db.lists.put(newList);
      } else if (!localIsNewer) {
        const merged: ShoppingList = {
          ...existing,
          name: sl.name,
          position: sl.position,
          updatedAt: sl.updatedAt,
          deleted: sl.deleted,
          dirty: 0,
        };
        await db.lists.put(merged);
      } else {
        // Local is newer & still dirty — keep, will be pushed next round.
      }

      for (const si of sl.items ?? []) {
        const localItem = await db.items.get(si.id);
        const localItemNewer =
          localItem &&
          (localItem.updatedAt ?? 0) > (si.updatedAt ?? 0) &&
          localItem.dirty > 0;
        if (localItemNewer) continue;

        const merged: ShoppingItem = {
          id: si.id,
          listId: sl.id,
          name: si.name,
          quantity: si.quantity,
          checked: si.checked,
          position: si.position,
          updatedAt: si.updatedAt,
          deleted: si.deleted,
          dirty: 0,
        };
        await db.items.put(merged);
      }
    }
  });
}

async function clearDirtyForPushed(payload: SyncListPayload[]): Promise<void> {
  await db.transaction("rw", db.lists, db.items, async () => {
    for (const p of payload) {
      const list = await db.lists.get(p.id);
      if (list && list.updatedAt === p.updatedAt) {
        await db.lists.update(p.id, { dirty: 0 });
      }
      for (const it of p.items) {
        const local = await db.items.get(it.id);
        if (local && local.updatedAt === it.updatedAt) {
          await db.items.update(it.id, { dirty: 0 });
        }
      }
    }
  });
}

export async function runSync(): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { ok: false, reason: "offline" };
  }

  try {
    const pushPayload = await buildPushPayload();
    if (pushPayload.length > 0) {
      const pushRes = await api.push(pushPayload);
      await applyServerLists(pushRes.lists);
      await clearDirtyForPushed(pushPayload);
      await setMeta(SERVER_VERSION_KEY, pushRes.serverVersion);
    }

    const since = (await getMeta<number>(LAST_PULL_KEY)) ?? 0;
    const pullRes = await api.pull(since);
    await applyServerLists(pullRes.lists);
    await setMeta(LAST_PULL_KEY, pullRes.serverTime);
    await setMeta(SERVER_VERSION_KEY, pullRes.serverVersion);

    return { ok: true, pushed: pushPayload.length, pulled: pullRes.lists.length };
  } catch (err) {
    if (err instanceof api.HttpError && err.status === 401) {
      return { ok: false, reason: "auth", message: err.message };
    }
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function pendingChangesCount(): Promise<number> {
  const lists = await db.lists.where("dirty").above(0).count();
  const items = await db.items.where("dirty").above(0).count();
  return lists + items;
}
