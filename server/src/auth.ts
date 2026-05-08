import type { NextFunction, Request, Response } from "express";
import { env } from "./env.js";

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token !== env.APP_PASSWORD) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
