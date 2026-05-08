export type ShoppingItem = {
  id: string;
  listId: string;
  name: string;
  quantity: string;
  checked: boolean;
  position: number;
  updatedAt: number;
  deleted: boolean;
  // 0 = clean, >0 = dirty (needs to be pushed to server).
  dirty: number;
  // True only while a record exists locally but has never been
  // confirmed by the server (e.g. created offline). Cleared after the
  // first successful push or pull. Reorders / renames don't touch this.
  // Drives the "not yet synced" opacity hint on rows.
  localOnly?: boolean;
};

export type ShoppingList = {
  id: string;
  name: string;
  position: number;
  updatedAt: number;
  deleted: boolean;
  dirty: number;
  localOnly?: boolean;
};

export type SyncListPayload = {
  id: string;
  name: string;
  position: number;
  updatedAt: number;
  deleted: boolean;
  items: Array<{
    id: string;
    name: string;
    quantity: string;
    checked: boolean;
    position: number;
    updatedAt: number;
    deleted: boolean;
  }>;
};
