import { Router } from "express";
import { getSetting } from "../db/index.js";
import {
  createTask,
  deleteTask,
  getProject,
  getRepository,
  getTask,
  listTasksForProject,
} from "../projects/store.js";
import { startTaskRun } from "../runner/runner.js";

export const tasksRouter = Router();

tasksRouter.get("/:id/tasks", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(listTasksForProject(project.id));
});

tasksRouter.post("/:id/tasks", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  const { description } = req.body as { description?: string };
  if (!description || !description.trim()) {
    res.status(400).json({ error: "description is required" });
    return;
  }
  const task = createTask({ projectId: project.id, description: description.trim() });
  res.status(201).json(task);
});

tasksRouter.delete("/:id/tasks/:taskId", (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== req.params.id) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  deleteTask(task.id);
  res.json({ ok: true });
});

tasksRouter.post("/:id/tasks/:taskId/start", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== project.id) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  if (task.status === "running") {
    res.status(409).json({ error: "task is already running" });
    return;
  }
  const repo = getRepository(project.repository_id);
  if (!repo) {
    res.status(404).json({ error: "repository not found" });
    return;
  }
  const agentCommand = getSetting("agent_command") ?? "claude -p --dangerously-skip-permissions";
  startTaskRun({ project, repo, task, agentCommand });
  // Status is flipped to "running" synchronously inside startTaskRun before it returns.
  res.status(202).json(getTask(task.id));
});
