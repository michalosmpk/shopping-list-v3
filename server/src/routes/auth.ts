import { Router } from "express";
import {
  getProfileByUserId,
  refreshSession,
  signInWithName,
} from "../lib/users.js";
import { signAdminElevatedToken } from "../lib/jwt.js";
import { requireAuth } from "../auth.js";

export const authRouter = Router();

// POST /api/auth/login  { name, password }
//   -> { access_token, refresh_token, expires_at, user: { id, name, displayName, isAdmin } }
authRouter.post("/login", async (req, res, next) => {
  try {
    const { name, password } = req.body ?? {};
    if (typeof name !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const { data, error } = await signInWithName({ name, password });
    if (error || !data.session || !data.user) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    const profile = await getProfileByUserId(data.user.id);
    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.user.id,
        name: profile?.name ?? "",
        displayName: profile?.display_name ?? profile?.name ?? "",
        isAdmin: profile?.is_admin ?? false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh  { refresh_token }
authRouter.post("/refresh", async (req, res, next) => {
  try {
    const { refresh_token } = req.body ?? {};
    if (typeof refresh_token !== "string") {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const { data, error } = await refreshSession(refresh_token);
    if (error || !data.session || !data.user) {
      res.status(401).json({ error: "refresh_failed" });
      return;
    }
    const profile = await getProfileByUserId(data.user.id);
    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.user.id,
        name: profile?.name ?? "",
        displayName: profile?.display_name ?? profile?.name ?? "",
        isAdmin: profile?.is_admin ?? false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — quick check + freshly fetched profile.
authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    if (!req.session || req.session.kind !== "user") {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const profile = await getProfileByUserId(req.session.userId);
    res.json({
      kind: "user",
      user: profile && {
        id: profile.user_id,
        name: profile.name,
        displayName: profile.display_name,
        isAdmin: profile.is_admin,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reauth-admin  { password }  (Authorization: Bearer <user>)
//   -> { admin_token, expires_in }
authRouter.post("/reauth-admin", requireAuth, async (req, res, next) => {
  try {
    if (!req.session || req.session.kind !== "user") {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!req.session.isAdmin) {
      res.status(403).json({ error: "not_an_admin" });
      return;
    }
    const profile = await getProfileByUserId(req.session.userId);
    if (!profile) {
      res.status(404).json({ error: "profile_missing" });
      return;
    }
    const { password } = req.body ?? {};
    if (typeof password !== "string" || !password) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const { data, error } = await signInWithName({
      name: profile.name,
      password,
    });
    if (error || !data.session) {
      res.status(401).json({ error: "invalid_password" });
      return;
    }
    const adminToken = signAdminElevatedToken(req.session.userId);
    res.json({
      admin_token: adminToken,
      expires_in: 300, // matches ADMIN_REAUTH_TTL_SECONDS default
    });
  } catch (err) {
    next(err);
  }
});
