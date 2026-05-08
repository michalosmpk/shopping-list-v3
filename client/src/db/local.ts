import Dexie, { type Table } from "dexie";
import type { ShoppingItem, ShoppingList } from "../types";

class LocalDb extends Dexie {
  lists!: Table<ShoppingList, string>;
  items!: Table<ShoppingItem, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("shopping-list-v3");
    this.version(1).stores({
      // [dirty+updatedAt] used by sync engine to find pending changes.
      lists: "id, position, updatedAt, deleted, dirty",
      items: "id, listId, position, updatedAt, deleted, dirty, [listId+position]",
      meta: "key",
    });
  }
}

export const db = new LocalDb();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
