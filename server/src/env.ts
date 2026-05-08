import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

// Resolve .env from repo root, regardless of which cwd the server was
// started from. Falls back to server/.env if a local one exists.
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, "../../.env"),       // monorepo root (compiled dist/)
  resolve(here, "../.env"),          // monorepo root (tsx src/)
  resolve(here, "../../../.env"),    // safety net for nested layouts
  resolve(here, "../../server/.env"),// per-package override
];
const found = candidates.find((p) => existsSync(p));
if (found) {
  dotenvConfig({ path: found });
  console.log(`[env] loaded ${found}`);
} else {
  dotenvConfig();
  console.log("[env] no .env found, relying on process.env");
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// Resolve DATA_FILE relative to the repo root (one up from server/) so the
// JSON store lives outside the workspace package and survives rebuilds.
const repoRoot = found ? dirname(found) : resolve(here, "..");
const defaultDataFile = resolve(repoRoot, "data/shopping-list.json");

export const env = {
  APP_PASSWORD: required("APP_PASSWORD", "changeme"),
  DATA_FILE: process.env.DATA_FILE
    ? resolve(repoRoot, process.env.DATA_FILE)
    : defaultDataFile,
  PORT: Number(process.env.PORT ?? 4000),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  NODE_ENV: process.env.NODE_ENV ?? "development",
};
