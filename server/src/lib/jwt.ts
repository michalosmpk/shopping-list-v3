import jwt from "jsonwebtoken";
import { env } from "../env.js";

// Three token kinds flow through the BFF:
//
//   1. Supabase access tokens   — issued by GoTrue when a real user logs in.
//                                 Sent on Authorization: Bearer for normal API.
//   2. BFF guest tokens         — minted here for /share/<token> sessions,
//                                 scoped to a single list_id, no user account.
//                                 Sent on Authorization: Bearer for /api/sync.
//   3. BFF admin-elevated tokens — minted here when an admin re-auths.
//                                 Sent on X-Admin-Token: Bearer to gate
//                                 admin-only endpoints. Short-lived.
//
// The `kind` claim distinguishes guest/admin-elevated tokens from
// Supabase-issued ones so the auth middleware can route requests
// without ambiguity.

export type GuestClaims = {
  kind: "guest";
  list_id: string;
  share_token: string;
  iat: number;
};

export type AdminElevatedClaims = {
  kind: "admin";
  user_id: string;
  iat: number;
  exp: number;
};

const ISSUER = "shopping-list-v3";

export function signGuestToken(opts: {
  list_id: string;
  share_token: string;
}): string {
  const payload: GuestClaims = {
    kind: "guest",
    list_id: opts.list_id,
    share_token: opts.share_token,
    iat: Math.floor(Date.now() / 1000),
  };
  return jwt.sign(payload, env.JWT_SECRET, { issuer: ISSUER });
}

export function signAdminElevatedToken(user_id: string): string {
  return jwt.sign(
    { kind: "admin", user_id },
    env.JWT_SECRET,
    {
      issuer: ISSUER,
      expiresIn: env.ADMIN_REAUTH_TTL_SECONDS,
    }
  );
}

export function verifyBffToken<T = unknown>(token: string): T {
  return jwt.verify(token, env.JWT_SECRET, { issuer: ISSUER }) as T;
}

// Try the BFF secret first (guest/admin tokens); anything else is left
// for the caller to validate via Supabase's auth.getUser() (ES256 with
// a JWKS-managed signing key in modern Supabase).
export type BffToken =
  | { kind: "guest"; claims: GuestClaims }
  | { kind: "admin"; claims: AdminElevatedClaims };

export function tryDecodeBffToken(token: string): BffToken | null {
  try {
    const claims = verifyBffToken<{ kind?: string }>(token);
    if (claims.kind === "guest") {
      return { kind: "guest", claims: claims as GuestClaims };
    }
    if (claims.kind === "admin") {
      return { kind: "admin", claims: claims as AdminElevatedClaims };
    }
    return null;
  } catch {
    return null;
  }
}
