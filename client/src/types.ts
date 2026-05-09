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
  // Audience metadata, populated by the server on every pull/push.
  // For lists created locally that haven't synced yet these fields can
  // be undefined; the UI treats `undefined` as "owned by me" so the
  // creator keeps full control until the first push round-trips.
  ownerId?: string;
  ownerName?: string;
  isOwner?: boolean;
  // True when the list is exposed to anyone besides its owner — public
  // guest link enabled or at least one named member. Drives the
  // "shared" badge on the lists overview for both owners and members.
  shared?: boolean;
};

export type SyncListPayload = {
  id: string;
  name: string;
  position: number;
  updatedAt: number;
  deleted: boolean;
  // These four are server-populated and ignored on push (the server
  // re-derives them per-recipient).
  ownerId?: string;
  ownerName?: string;
  isOwner?: boolean;
  shared?: boolean;
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
