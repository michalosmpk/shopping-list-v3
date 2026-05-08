import type { NextFunction, Request, Response } from "express";
import { tryDecodeBffToken, verifyBffToken } from "./lib/jwt.js";
import { supabaseAdmin } from "./lib/supabase.js";

// Session attached to req after a successful auth check.
export type Session =
  | {
      kind: "user";
      userId: string;
      isAdmin: boolean;
    }
  | {
      kind: "guest";
      listId: string;
      shareToken: string;
    };

declare module "express-serve-static-core" {
  interface Request {
    session?: Session;
    adminElevated?: boolean;
  }
}

function readBearer(req: Request, header = "authorization"): string | null {
  const raw = req.headers[header];
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("Bearer ")) return null;
  return raw.slice("Bearer ".length).trim() || null;
}

// Accepts either a Supabase user token or a BFF-signed guest token.
// Populates req.session, fetches profile.is_admin lazily for users.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = readBearer(req);
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // BFF-signed first: cheap (no network) and tells us guest vs admin.
  const bff = tryDecodeBffToken(token);
  if (bff?.kind === "guest") {
    req.session = {
      kind: "guest",
      listId: bff.claims.list_id,
      shareToken: bff.claims.share_token,
    };
    next();
    return;
  }
  // Admin-elevated tokens are *not* a session by themselves — they
  // accompany a regular user token on the X-Admin-Token header. Reject
  // them here so we can't be tricked into treating one as a session.
  if (bff?.kind === "admin") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // Otherwise it must be a Supabase-issued user access token. Modern
  // Supabase signs them with an asymmetric key (ES256) and rotates the
  // signing key, so we delegate verification to the SDK.
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  const userId = data.user.id;
  const isAdmin = await getIsAdmin(userId);
  req.session = { kind: "user", userId, isAdmin };
  next();
}

// Stricter middleware for admin-only endpoints. Requires a valid user
// session AND a fresh admin-elevated token in `X-Admin-Token`.
export async function requireAdminElevated(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.session || req.session.kind !== "user") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!req.session.isAdmin) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const elevated = readBearer(req, "x-admin-token");
  if (!elevated) {
    res.status(401).json({ error: "admin_reauth_required" });
    return;
  }
  try {
    const claims = verifyBffToken<{
      kind?: string;
      user_id?: string;
    }>(elevated);
    if (
      claims.kind !== "admin" ||
      !claims.user_id ||
      claims.user_id !== req.session.userId
    ) {
      res.status(401).json({ error: "admin_reauth_required" });
      return;
    }
    req.adminElevated = true;
    next();
  } catch {
    res.status(401).json({ error: "admin_reauth_required" });
  }
}

async function getIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return Boolean((data as { is_admin?: boolean }).is_admin);
}
