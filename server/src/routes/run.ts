import { Router } from "express";
import { tick } from "../scheduler/tick.js";
import { getProject, listRunsForTicket, listTicketsWithDeps } from "../projects/store.js";

export const runRouter = Router();

function runState(projectId: string) {
  const project = getProject(projectId);
  if (!project) return undefined;
  const tickets = listTicketsWithDeps(projectId).map((t) => ({ ...t, runs: listRunsForTicket(t.id) }));
  return { project, tickets };
}

runRouter.get("/:id/run-state", (req, res) => {
  const state = runState(req.params.id);
  if (!state) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(state);
});

runRouter.post("/:id/refresh", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  await tick(project.id);
  res.json(runState(project.id));
});
