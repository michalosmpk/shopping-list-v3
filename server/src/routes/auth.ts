import { Router } from "express";
import { env } from "../env.js";

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const { password } = req.body ?? {};
  if (typeof password !== "string" || password !== env.APP_PASSWORD) {
    res.status(401).json({ error: "invalid_password" });
    return;
  }
  // Token is intentionally simple: the password itself acts as the bearer
  // token. Stored client-side with a 365-day expiry. Plenty for a personal
  // shopping list — swap for JWT/session if you ever need real users.
  res.json({ token: env.APP_PASSWORD, expiresInDays: 365 });
});

authRouter.get("/check", (_req, res) => {
  res.json({ ok: true });
});
