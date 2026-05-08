import { Router } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { requireAuth } from "../auth.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { signGuestToken } from "../lib/jwt.js";
import { getRawListById, getRawListByShareToken } from "../lib/repo.js";

export const shareRouter = Router();

// Easy-to-paste tokens: 16 url-safe chars (~96 bits of entropy).
function generateShareToken(): string {
  return randomBytes(12).toString("base64url");
}

// ---- Owner endpoints (require authenticated user) -------------------

// GET /api/share/:listId — get current share state for a list.
shareRouter.get("/:listId", requireAuth, async (req, res, next) => {
  try {
    if (!req.session || req.session.kind !== "user") {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const list = await getRawListById(req.params.listId!);
    if (!list || list.deleted) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (list.owner_id !== req.session.userId && !req.session.isAdmin) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.json({
      enabled: list.share_enabled,
      token: list.share_token,
      hasPassword: Boolean(list.share_password_hash),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/share/:listId — enable/configure sharing.
//   Body: { enabled?: boolean, password?: string, regenerate?: boolean }
shareRouter.put("/:listId", requireAuth, async (req, res, next) => {
  try {
    if (!req.session || req.session.kind !== "user") {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const list = await getRawListById(req.params.listId!);
    if (!list || list.deleted) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (list.owner_id !== req.session.userId && !req.session.isAdmin) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const { enabled, password, regenerate } = req.body ?? {};

    const patch: Record<string, unknown> = {};
    if (typeof enabled === "boolean") patch.share_enabled = enabled;
    if (regenerate || (enabled && !list.share_token)) {
      patch.share_token = generateShareToken();
    }
    if (typeof password === "string" && password.length > 0) {
      patch.share_password_hash = await bcrypt.hash(password, 10);
    } else if (password === null) {
      patch.share_password_hash = null;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no_changes" });
      return;
    }
    patch.updated_at_ms = Date.now();

    const { data, error } = await supabaseAdmin
      .from("lists")
      .update(patch)
      .eq("id", list.id)
      .select("*")
      .single();
    if (error) throw error;

    const updated = data as typeof list;
    res.json({
      enabled: updated.share_enabled,
      token: updated.share_token,
      hasPassword: Boolean(updated.share_password_hash),
    });
  } catch (err) {
    next(err);
  }
});

// ---- Public guest endpoints (no auth required) ----------------------

// GET /api/share/info/:token — does this share exist & need a password?
shareRouter.get("/info/:token", async (req, res, next) => {
  try {
    const list = await getRawListByShareToken(req.params.token!);
    if (!list || list.deleted || !list.share_enabled || !list.share_token) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      ok: true,
      listName: list.name,
      requiresPassword: Boolean(list.share_password_hash),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/share/auth/:token  { password }  -> { token, list_id, listName }
shareRouter.post("/auth/:token", async (req, res, next) => {
  try {
    const list = await getRawListByShareToken(req.params.token!);
    if (!list || list.deleted || !list.share_enabled || !list.share_token) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const { password } = req.body ?? {};
    if (list.share_password_hash) {
      if (typeof password !== "string" || password.length === 0) {
        res.status(401).json({ error: "password_required" });
        return;
      }
      const ok = await bcrypt.compare(password, list.share_password_hash);
      if (!ok) {
        res.status(401).json({ error: "invalid_password" });
        return;
      }
    }
    const token = signGuestToken({
      list_id: list.id,
      share_token: list.share_token,
    });
    res.json({
      token,
      list_id: list.id,
      listName: list.name,
    });
  } catch (err) {
    next(err);
  }
});
