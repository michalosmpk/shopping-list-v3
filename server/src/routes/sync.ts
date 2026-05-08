import { Router } from "express";
import {
  getDb,
  getServerVersion,
  type StoredItem,
  type StoredList,
} from "../db.js";

export const syncRouter = Router();

// Lightweight ping: client polls this on a short interval to detect
// remote changes without paying the cost of a full pull. `serverVersion`
// is the data file's mtime; clients compare to their last-seen value.
syncRouter.get("/heartbeat", (_req, res) => {
  res.json({
    serverTime: Date.now(),
    serverVersion: getServerVersion(),
  });
});

type ItemPayload = {
  id: string;
  name?: string;
  quantity?: string;
  checked?: boolean;
  position?: number;
  updatedAt: number;
  deleted?: boolean;
};

type ListPayload = {
  id: string;
  name?: string;
  position?: number;
  items?: ItemPayload[];
  updatedAt: number;
  deleted?: boolean;
};

function toStoredItem(p: ItemPayload, fallback?: StoredItem): StoredItem {
  return {
    id: p.id,
    name: p.name ?? fallback?.name ?? "",
    quantity: p.quantity ?? fallback?.quantity ?? "",
    checked: p.checked ?? fallback?.checked ?? false,
    position: p.position ?? fallback?.position ?? 0,
    updatedAt: p.updatedAt,
    deleted: p.deleted ?? fallback?.deleted ?? false,
  };
}

function mergeItems(
  existing: StoredItem[],
  incoming: ItemPayload[]
): StoredItem[] {
  const byId = new Map<string, StoredItem>(existing.map((i) => [i.id, i]));
  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur || inc.updatedAt >= cur.updatedAt) {
      byId.set(inc.id, toStoredItem(inc, cur));
    }
  }
  return Array.from(byId.values());
}

// Pull all lists. `since` is accepted but currently the server returns
// everything — it's small (a single user's shopping lists). Tombstones
// (deleted flag) flow through too so the client can purge.
syncRouter.get("/", async (req, res) => {
  const since = Number(req.query.since ?? 0) || 0;
  const db = getDb();
  await db.read();

  const lists = db.data.lists.filter(
    (l) => !l.deleted || l.updatedAt > since
  );

  res.json({
    serverTime: Date.now(),
    serverVersion: getServerVersion(),
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      position: l.position,
      items: l.items.map((i) => ({ ...i })),
      updatedAt: l.updatedAt,
      deleted: l.deleted,
    })),
  });
});

// Push client changes. Last-writer-wins by `updatedAt` per list and per
// item. Returns merged server state for pushed lists.
syncRouter.post("/", async (req, res) => {
  const incoming = (req.body?.lists ?? []) as ListPayload[];
  if (!Array.isArray(incoming)) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const db = getDb();
  await db.read();
  const merged: StoredList[] = [];

  for (const p of incoming) {
    if (!p?.id || typeof p.updatedAt !== "number") continue;

    const idx = db.data.lists.findIndex((l) => l.id === p.id);
    if (idx === -1) {
      const created: StoredList = {
        id: p.id,
        name: p.name ?? "Untitled list",
        position: p.position ?? 0,
        updatedAt: p.updatedAt,
        deleted: p.deleted ?? false,
        items: (p.items ?? []).map((it) => toStoredItem(it)),
      };
      db.data.lists.push(created);
      merged.push(created);
      continue;
    }

    const existing = db.data.lists[idx]!;
    const items = mergeItems(existing.items, p.items ?? []);

    const listIsNewer = p.updatedAt >= existing.updatedAt;
    const next: StoredList = {
      ...existing,
      name: listIsNewer ? p.name ?? existing.name : existing.name,
      position: listIsNewer
        ? p.position ?? existing.position
        : existing.position,
      deleted: listIsNewer ? p.deleted ?? existing.deleted : existing.deleted,
      updatedAt: listIsNewer ? p.updatedAt : existing.updatedAt,
      items,
    };
    db.data.lists[idx] = next;
    merged.push(next);
  }

  await db.write();

  res.json({
    serverTime: Date.now(),
    serverVersion: getServerVersion(),
    lists: merged.map((l) => ({
      id: l.id,
      name: l.name,
      position: l.position,
      items: l.items.map((i) => ({ ...i })),
      updatedAt: l.updatedAt,
      deleted: l.deleted,
    })),
  });
});
