import { v4 as uuid } from "uuid";
import { db } from "./local";
import type { ShoppingItem, ShoppingList } from "../types";

const now = () => Date.now();

export async function createList(name: string): Promise<ShoppingList> {
  const last = await db.lists
    .orderBy("position")
    .reverse()
    .filter((l) => !l.deleted)
    .first();
  const list: ShoppingList = {
    id: uuid(),
    name: name.trim() || "Untitled list",
    position: (last?.position ?? 0) + 1,
    updatedAt: now(),
    deleted: false,
    dirty: 1,
  };
  await db.lists.add(list);
  return list;
}

export async function renameList(id: string, name: string) {
  await db.lists.update(id, {
    name: name.trim() || "Untitled list",
    updatedAt: now(),
    dirty: 1,
  });
}

export async function deleteList(id: string) {
  await db.transaction("rw", db.lists, db.items, async () => {
    const ts = now();
    await db.lists.update(id, { deleted: true, updatedAt: ts, dirty: 1 });
    const items = await db.items.where({ listId: id }).toArray();
    for (const it of items) {
      await db.items.update(it.id, {
        deleted: true,
        updatedAt: ts,
        dirty: 1,
      });
    }
  });
}

export async function reorderLists(orderedIds: string[]) {
  const ts = now();
  await db.transaction("rw", db.lists, async () => {
    let pos = 1;
    for (const id of orderedIds) {
      await db.lists.update(id, { position: pos, updatedAt: ts, dirty: 1 });
      pos += 1;
    }
  });
}

export async function createItem(
  listId: string,
  name: string,
  quantity = ""
): Promise<ShoppingItem> {
  const last = await db.items
    .where({ listId })
    .filter((i) => !i.deleted)
    .reverse()
    .sortBy("position");
  const lastPos = last[0]?.position ?? 0;
  const item: ShoppingItem = {
    id: uuid(),
    listId,
    name: name.trim(),
    quantity: quantity.trim(),
    checked: false,
    position: lastPos + 1,
    updatedAt: now(),
    deleted: false,
    dirty: 1,
  };
  await db.items.add(item);
  await db.lists.update(listId, { updatedAt: now(), dirty: 1 });
  return item;
}

export async function toggleItem(id: string) {
  const it = await db.items.get(id);
  if (!it) return;
  await db.items.update(id, {
    checked: !it.checked,
    updatedAt: now(),
    dirty: 1,
  });
}

export async function renameItem(
  id: string,
  patch: { name?: string; quantity?: string }
) {
  await db.items.update(id, {
    ...patch,
    updatedAt: now(),
    dirty: 1,
  });
}

export async function deleteItem(id: string) {
  await db.items.update(id, {
    deleted: true,
    updatedAt: now(),
    dirty: 1,
  });
}

export async function reorderItems(listId: string, orderedIds: string[]) {
  const ts = now();
  await db.transaction("rw", db.items, async () => {
    let pos = 1;
    for (const id of orderedIds) {
      await db.items.update(id, { position: pos, updatedAt: ts, dirty: 1 });
      pos += 1;
    }
  });
  await db.lists.update(listId, { updatedAt: ts, dirty: 1 });
}

export async function clearChecked(listId: string) {
  const ts = now();
  await db.transaction("rw", db.items, async () => {
    const items = await db.items
      .where({ listId })
      .filter((i) => i.checked && !i.deleted)
      .toArray();
    for (const it of items) {
      await db.items.update(it.id, {
        deleted: true,
        updatedAt: ts,
        dirty: 1,
      });
    }
  });
}
