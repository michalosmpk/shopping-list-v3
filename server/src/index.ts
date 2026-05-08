import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import { env } from "./env.js";
import { authRouter } from "./routes/auth.js";
import { syncRouter } from "./routes/sync.js";
import { adminRouter } from "./routes/admin.js";
import { shareRouter } from "./routes/share.js";
import { pingSupabase } from "./lib/supabase.js";
import { bootstrapAdminIfNeeded } from "./lib/users.js";

async function main() {
  const app = express();
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN === "*" ? true : env.CLIENT_ORIGIN.split(","),
      exposedHeaders: ["X-Admin-Token"],
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.use((req, _res, next) => {
    if (env.NODE_ENV !== "production") {
      console.log(`[req] ${req.method} ${req.url}`);
    }
    next();
  });

  app.get("/api/health", async (_req, res) => {
    const db = await pingSupabase();
    res.json({ ok: true, db: db.ok, dbMessage: db.message });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/sync", syncRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/share", shareRouter);

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    console.error(`[err] ${req.method} ${req.url}`, err);
    if (res.headersSent) return;
    res.status(500).json({
      error: "server_error",
      message:
        env.NODE_ENV === "production"
          ? "Internal error."
          : (err as Error)?.message ?? String(err),
    });
  };
  app.use(errorHandler);

  app.listen(env.PORT, () => {
    console.log(`[server] http://localhost:${env.PORT}`);
  });

  // Probe Supabase + bootstrap admin in the background. Failure here
  // doesn't kill the process — the server still serves /api/health so
  // we can diagnose connectivity issues without restart loops.
  void (async () => {
    const ping = await pingSupabase();
    if (!ping.ok) {
      console.warn(
        `[supabase] not reachable yet: ${ping.message}\n` +
          `           is the local stack running? \`npm run supabase:start\``
      );
      return;
    }
    console.log(`[supabase] connected at ${env.SUPABASE_URL}`);
    try {
      await bootstrapAdminIfNeeded();
    } catch (err) {
      console.error("[bootstrap] failed", err);
    }
  })();
}

main().catch((err) => {
  console.error("[server] fatal", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
