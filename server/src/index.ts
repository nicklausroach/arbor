import cors from "cors";
import express from "express";
import { migrate } from "./db/index.js";
import { approveRouter } from "./routes/approve.js";
import { projectsRouter } from "./routes/projects.js";
import { reposRouter } from "./routes/repos.js";
import { runRouter } from "./routes/run.js";
import { runLogRouter } from "./routes/runLog.js";
import { settingsRouter } from "./routes/settings.js";
import { listRunningProjects } from "./projects/store.js";
import { tick } from "./scheduler/tick.js";

migrate();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/repos", reposRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/projects", approveRouter);
app.use("/api/projects", runRouter);
app.use("/api/runs", runLogRouter);
app.use("/api/settings", settingsRouter);

setInterval(() => {
  for (const project of listRunningProjects()) {
    tick(project.id).catch((err) => console.error(`scheduler tick failed for ${project.id}:`, err));
  }
}, 60_000);

const PORT = Number(process.env.PORT ?? 4310);
app.listen(PORT, () => {
  console.log(`arbor server listening on http://localhost:${PORT}`);
});
