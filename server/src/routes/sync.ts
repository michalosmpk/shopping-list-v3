import { Router } from "express";
import {
  applyClientChanges,
  getListById,
  getListsForUser,
  listServerVersion,
  userServerVersion,
} from "../lib/repo.js";
import { requireAuth } from "../auth.js";

export const syncRouter = Router();

syncRouter.use(requireAuth);

// GET /api/sync/heartbeat — cheap "did anything change?" probe.
syncRouter.get("/heartbeat", async (req, res, next) => {
  try {
    const session = req.session!;
    const version =
      session.kind === "user"
        ? await userServerVersion(session.userId)
        : await listServerVersion(session.listId);
    res.json({ serverTime: Date.now(), serverVersion: version });
  } catch (err) {
    next(err);
  }
});

// GET /api/sync — full pull, scoped to the session.
syncRouter.get("/", async (req, res, next) => {
  try {
    const session = req.session!;
    const lists =
      session.kind === "user"
        ? await getListsForUser(session.userId)
        : (() => {
            // Wrap the maybe-null list in an array (or empty if missing).
            return getListById(session.listId).then((l) => (l ? [l] : []));
          })();
    const resolved = await Promise.resolve(lists);
    const version =
      session.kind === "user"
        ? await userServerVersion(session.userId)
        : await listServerVersion(session.listId);
    res.json({
      serverTime: Date.now(),
      serverVersion: version,
      lists: resolved,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/sync — push client changes; returns merged server view.
syncRouter.post("/", async (req, res, next) => {
  try {
    const session = req.session!;
    const incoming = req.body?.lists;
    if (!Array.isArray(incoming)) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const merged =
      session.kind === "user"
        ? await applyClientChanges({ kind: "user", userId: session.userId }, incoming)
        : await applyClientChanges({ kind: "guest", listId: session.listId }, incoming);
    const version =
      session.kind === "user"
        ? await userServerVersion(session.userId)
        : await listServerVersion(session.listId);
    res.json({
      serverTime: Date.now(),
      serverVersion: version,
      lists: merged,
    });
  } catch (err) {
    next(err);
  }
});
