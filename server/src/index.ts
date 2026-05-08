import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import { env } from "./env.js";
import { connectDb, isDbReady } from "./db.js";
import { requireAuth } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { syncRouter } from "./routes/sync.js";

async function main() {
  // lowdb is just a JSON file — connect synchronously before binding the
  // port so the first request always sees a ready DB.
  await connectDb();

  const app = express();
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN === "*" ? true : env.CLIENT_ORIGIN.split(","),
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.use((req, _res, next) => {
    if (env.NODE_ENV !== "production") {
      console.log(`[req] ${req.method} ${req.url}`);
    }
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, db: isDbReady() });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/sync", requireAuth, syncRouter);

  // 404 handler.
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  // Error handler — logs the actual stack trace so we never get silent 500s.
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
}

main().catch((err) => {
  console.error("[server] fatal", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
