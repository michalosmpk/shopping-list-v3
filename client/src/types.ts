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
};

export type ShoppingList = {
  id: string;
  name: string;
  position: number;
  updatedAt: number;
  deleted: boolean;
  dirty: number;
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
