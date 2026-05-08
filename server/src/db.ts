import { JSONFilePreset } from "lowdb/node";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./env.js";

export type StoredItem = {
  id: string;
  name: string;
  quantity: string;
  checked: boolean;
  position: number;
  updatedAt: number;
  deleted: boolean;
};

export type StoredList = {
  id: string;
  name: string;
  position: number;
  items: StoredItem[];
  updatedAt: number;
  deleted: boolean;
};

export type Schema = {
  lists: StoredList[];
};

let db: Awaited<ReturnType<typeof JSONFilePreset<Schema>>> | null = null;

export async function connectDb(): Promise<void> {
  mkdirSync(dirname(env.DATA_FILE), { recursive: true });
  db = await JSONFilePreset<Schema>(env.DATA_FILE, { lists: [] });
  await db.read();
  if (!db.data.lists) {
    db.data.lists = [];
    await db.write();
  }
  console.log(`[db] using ${env.DATA_FILE}`);
}

export function isDbReady(): boolean {
  return db !== null;
}

export function getDb() {
  if (!db) throw new Error("DB not initialized");
  return db;
}

// "Version" is the data file's last-modified time in ms. It changes
// every time lowdb writes (i.e. every time data actually changes), and
// stays stable otherwise. Cheap to read and good enough as a fingerprint
// for the heartbeat endpoint.
export function getServerVersion(): number {
  try {
    return Math.floor(statSync(env.DATA_FILE).mtimeMs);
  } catch {
    return 0;
  }
}
