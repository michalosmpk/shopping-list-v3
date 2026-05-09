import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  // In production we ship a single process: same Express server hands
  // out the built Vite SPA so there's no separate static host to run.
  // Locating client/dist relative to the compiled server file means this
  // works whether the user runs `node server/dist/index.js` from the
  // repo root or from server/.
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDistCandidates = [
    resolve(here, "../../client/dist"),
    resolve(here, "../../../client/dist"),
  ];
  const clientDist = clientDistCandidates.find((p) => existsSync(p));
  if (clientDist) {
    // Files whose contents change between builds without their URL
    // changing — must never be cached, otherwise a redeploy looks
    // invisible until the user nukes their cache. Vite's hashed
    // /assets/* bundle gets the opposite treatment further down: a
    // 1-year immutable cache because its filename changes on every
    // build.
    const NEVER_CACHE = new Set([
      "/index.html",
      "/sw.js",
      "/registerSW.js",
      "/manifest.webmanifest",
      "/workbox-",
    ]);
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      const p = req.path;
      const noCache =
        p === "/" ||
        NEVER_CACHE.has(p) ||
        p.startsWith("/workbox-") ||
        p.endsWith(".webmanifest");
      if (noCache) {
        res.setHeader(
          "Cache-Control",
          "no-cache, no-store, must-revalidate"
        );
      }
      next();
    });
    app.use(
      express.static(clientDist, {
        index: false,
        // setHeaders runs AFTER the no-cache middleware above, so we
        // only override the long-lived `immutable` policy on the
        // hashed asset bundle. Everything else inherits the no-cache
        // header set up above.
        setHeaders(res, filePath) {
          if (filePath.includes(`${clientDist}/assets/`)) {
            res.setHeader(
              "Cache-Control",
              "public, max-age=31536000, immutable"
            );
          }
        },
      })
    );
    app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(resolve(clientDist, "index.html"));
    });
    console.log(`[static] serving SPA from ${clientDist}`);
  } else {
    console.log(
      "[static] no client/dist found — API-only mode (run `npm run build`)"
    );
  }

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
