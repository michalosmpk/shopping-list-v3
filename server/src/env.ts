import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

// Resolve .env from repo root regardless of which cwd the server was
// started from. Falls back to server/.env if a per-package override
// exists.
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

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // Supabase local stack — populated by `supabase start`. We delegate
  // user-token verification to the SDK so SUPABASE_JWT_SECRET is no
  // longer required server-side; it's still here for completeness in
  // case future code needs to verify legacy HS256 access tokens.
  SUPABASE_URL: required("SUPABASE_URL"),
  SUPABASE_ANON_KEY: required("SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),

  // BFF-signed tokens (guest sessions + admin-elevated proofs). Any long
  // random string; rotating it invalidates outstanding guest links.
  JWT_SECRET: required("JWT_SECRET"),
  ADMIN_REAUTH_TTL_SECONDS: Number(optional("ADMIN_REAUTH_TTL_SECONDS", "300")),

  // Synthetic email domain. Users only ever type a name; the BFF maps
  // <name> -> <name>@<EMAIL_DOMAIN> when calling Supabase Auth so we
  // never have to expose email as a UX concept.
  EMAIL_DOMAIN: optional("EMAIL_DOMAIN", "shoppinglist.local"),

  // Bootstrap: create an initial admin on first start if no admin
  // exists yet. After the first run this can be removed from .env.
  ADMIN_BOOTSTRAP_NAME: process.env.ADMIN_BOOTSTRAP_NAME,
  ADMIN_BOOTSTRAP_PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD,

  PORT: Number(optional("PORT", "4000")),
  CLIENT_ORIGIN: optional("CLIENT_ORIGIN", "http://localhost:5173"),
  NODE_ENV: optional("NODE_ENV", "development"),
};
