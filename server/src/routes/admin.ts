import { Router } from "express";
import {
  countAdmins,
  createUser,
  deleteUser,
  getProfileByUserId,
  listUsers,
  setUserAdmin,
} from "../lib/users.js";
import { requireAdminElevated, requireAuth } from "../auth.js";

export const adminRouter = Router();

// All admin endpoints require both a regular user session AND a fresh
// admin-elevated token (X-Admin-Token).
adminRouter.use(requireAuth, requireAdminElevated);

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const users = await listUsers();
    res.json({
      users: users.map((u) => ({
        id: u.user_id,
        name: u.name,
        displayName: u.display_name,
        isAdmin: u.is_admin,
        createdAt: u.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/users", async (req, res, next) => {
  try {
    const { name, displayName, password, isAdmin } = req.body ?? {};
    if (typeof name !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const profile = await createUser({
      name,
      displayName: typeof displayName === "string" ? displayName : undefined,
      password,
      isAdmin: Boolean(isAdmin),
    });
    res.status(201).json({
      user: {
        id: profile.user_id,
        name: profile.name,
        displayName: profile.display_name,
        isAdmin: profile.is_admin,
        createdAt: profile.created_at,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) {
      res.status(status).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
});

adminRouter.delete("/users/:id", async (req, res, next) => {
  try {
    const targetId = req.params.id;
    if (!targetId) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    if (
      req.session?.kind === "user" &&
      targetId === req.session.userId
    ) {
      res.status(400).json({ error: "cannot_delete_self" });
      return;
    }

    const target = await getProfileByUserId(targetId);
    if (target?.is_admin && (await countAdmins()) <= 1) {
      res.status(400).json({ error: "last_admin" });
      return;
    }

    await deleteUser(targetId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/users/:id", async (req, res, next) => {
  try {
    const targetId = req.params.id;
    if (!targetId) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const { isAdmin } = req.body ?? {};
    if (typeof isAdmin !== "boolean") {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    if (
      !isAdmin &&
      req.session?.kind === "user" &&
      targetId === req.session.userId
    ) {
      res.status(400).json({ error: "cannot_demote_self" });
      return;
    }
    if (!isAdmin && (await countAdmins()) <= 1) {
      const target = await getProfileByUserId(targetId);
      if (target?.is_admin) {
        res.status(400).json({ error: "last_admin" });
        return;
      }
    }
    const updated = await setUserAdmin(targetId, isAdmin);
    res.json({
      user: {
        id: updated.user_id,
        name: updated.name,
        displayName: updated.display_name,
        isAdmin: updated.is_admin,
        createdAt: updated.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});
