import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth } from "../auth.js";
import { getProfileByName } from "../lib/users.js";
import {
  addPresetMember,
  createPreset,
  deletePreset,
  getPreset,
  isPresetMember,
  isUniqueViolation,
  listPresetsForUser,
  parsePresetInput,
  removePresetMember,
} from "../lib/presets.js";

export const presetsRouter = Router();

// Presets are an account feature. Guest share tokens authenticate as a
// session, but they must not read or write someone else's saved presets.
function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.session || req.session.kind !== "user") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

presetsRouter.use(requireAuth, requireUser);

function userId(req: Request): string {
  return (req.session as { kind: "user"; userId: string }).userId;
}

// GET /api/presets — presets the caller owns, then ones shared with them.
presetsRouter.get("/", async (req, res, next) => {
  try {
    const presets = await listPresetsForUser(userId(req));
    res.json({ presets });
  } catch (err) {
    next(err);
  }
});

// POST /api/presets  { name, items: [{ name, quantity }] }
presetsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = parsePresetInput(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: "invalid_payload", message: parsed.error });
      return;
    }
    const preset = await createPreset(userId(req), parsed.name, parsed.items);
    res.status(201).json({ preset });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/presets/:id — owner only.
presetsRouter.delete("/:id", async (req, res, next) => {
  try {
    const preset = await getPreset(req.params.id!);
    if (!preset) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (preset.owner_id !== userId(req)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    await deletePreset(preset.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/presets/:id/members  { name }
presetsRouter.post("/:id/members", async (req, res, next) => {
  try {
    const preset = await getPreset(req.params.id!);
    if (!preset) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (preset.owner_id !== userId(req)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { name } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    const profile = await getProfileByName(name);
    if (!profile) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    if (profile.user_id === preset.owner_id) {
      res.status(400).json({ error: "cannot_add_owner" });
      return;
    }
    try {
      await addPresetMember(preset.id, profile.user_id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "already_member" });
        return;
      }
      throw err;
    }
    res.status(201).json({
      member: {
        id: profile.user_id,
        name: profile.name,
        displayName: profile.display_name,
      },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/presets/:id/members/:userId
// Owner can remove anyone. A member can remove only themselves.
presetsRouter.delete("/:id/members/:userId", async (req, res, next) => {
  try {
    const preset = await getPreset(req.params.id!);
    if (!preset) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const caller = userId(req);
    const target = req.params.userId!;
    const isOwner = preset.owner_id === caller;
    if (!isOwner && target !== caller) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (target === preset.owner_id) {
      res.status(400).json({ error: "cannot_remove_owner" });
      return;
    }
    if (!isOwner && !(await isPresetMember(preset.id, caller))) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    await removePresetMember(preset.id, target);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
