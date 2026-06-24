import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { migrate } from "./db/index.js";
import { previewAuthMiddleware } from "./previewAuth.js";
import { approveRouter } from "./routes/approve.js";
import { projectsRouter } from "./routes/projects.js";
import { reposRouter } from "./routes/repos.js";
import { runRouter } from "./routes/run.js";
import { runLogRouter } from "./routes/runLog.js";
import { settingsRouter } from "./routes/settings.js";
import { tasksRouter } from "./routes/tasks.js";
import { listRunningProjects } from "./projects/store.js";
import { attachSessionServer } from "./runner/sessionServer.js";
import { tick } from "./scheduler/tick.js";

migrate();

// This process supervises real long-running agent subprocesses and worktrees — an
// uncaught error in one request/connection handler must never take the whole
// server down and orphan every in-flight run's tracking.
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));

const app = express();
app.use(cors());
app.use(express.json());

// Private preview gate (no-op unless ARBOR_PREVIEW_TOKEN is set). Runs before any
// route so both the API and the static SPA below are protected.
app.use(previewAuthMiddleware);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/repos", reposRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/projects", approveRouter);
app.use("/api/projects", runRouter);
app.use("/api/projects", tasksRouter);
app.use("/api/runs", runLogRouter);
app.use("/api/settings", settingsRouter);

// In a packaged deployment (Fly preview app) the server also serves the built web SPA
// so it's a single app on one port. ARBOR_WEB_DIR points at web/dist; unset in local
// dev, where Vite serves the SPA and proxies /api + /ws here.
const webDir = process.env.ARBOR_WEB_DIR;
if (webDir && existsSync(webDir)) {
  app.use(express.static(webDir));
  // SPA fallback: anything that isn't an /api route returns index.html so client-side
  // routing works on deep links / refreshes.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(join(webDir, "index.html"));
  });
}

setInterval(() => {
  for (const project of listRunningProjects()) {
    tick(project.id).catch((err) => console.error(`scheduler tick failed for ${project.id}:`, err));
  }
}, 10_000);

const httpServer = createServer(app);
attachSessionServer(httpServer);

const PORT = Number(process.env.PORT ?? 4310);
httpServer.listen(PORT, () => {
  console.log(`arbor server listening on http://localhost:${PORT}`);
});
