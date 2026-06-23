import { Router } from "express";
import { AnthropicPlannerProvider } from "../planner/anthropicProvider.js";
import type { DraftTicket } from "../planner/types.js";
import { validateGraph } from "../planner/validate.js";
import { getAnthropicKey } from "./settings.js";
import {
  addChatMessage,
  createProject,
  getLatestGraphVersion,
  getProject,
  getRepository,
  insertGraphVersion,
  listChatMessages,
  listGraphVersions,
  listProjects,
} from "../projects/store.js";

export const projectsRouter = Router();

projectsRouter.get("/", (_req, res) => {
  res.json(listProjects());
});

projectsRouter.post("/", (req, res) => {
  const { repositoryId, title, objective } = req.body as {
    repositoryId?: string;
    title?: string;
    objective?: string;
  };
  if (!repositoryId || !title || !objective) {
    res.status(400).json({ error: "repositoryId, title, objective are required" });
    return;
  }
  if (!getRepository(repositoryId)) {
    res.status(404).json({ error: "repository not found" });
    return;
  }
  const project = createProject({ repositoryId, title, objective });
  addChatMessage(project.id, "user", objective);
  res.status(201).json(project);
});

function projectState(projectId: string) {
  const project = getProject(projectId);
  if (!project) return undefined;
  const latest = getLatestGraphVersion(projectId);
  return {
    project,
    tickets: latest?.tickets ?? [],
    currentVersion: latest?.versionNumber ?? 0,
    versions: listGraphVersions(projectId),
    messages: listChatMessages(projectId),
  };
}

projectsRouter.get("/:id", (req, res) => {
  const state = projectState(req.params.id);
  if (!state) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(state);
});

projectsRouter.post("/:id/chat", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  const repo = getRepository(project.repository_id);
  if (!repo) {
    res.status(404).json({ error: "repository not found" });
    return;
  }
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    res.status(400).json({ error: "No Anthropic API key configured. Add one in Settings." });
    return;
  }
  const { message, pinnedPaths } = req.body as { message?: string; pinnedPaths?: string[] };
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  addChatMessage(project.id, "user", message);
  const history = listChatMessages(project.id)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const previous = getLatestGraphVersion(project.id);

  const provider = new AnthropicPlannerProvider(apiKey);

  try {
    let result = await provider.draftGraph({
      repoPath: repo.local_path,
      objective: project.objective,
      pinnedPaths: pinnedPaths ?? [],
      history,
      userMessage: message,
      previousTickets: previous?.tickets,
      repairErrors: undefined,
    });
    for (const call of result.toolCalls) addChatMessage(project.id, "tool", `${call.tag} ${call.text}`);

    let validation = validateGraph(result.tickets);
    if (!validation.ok) {
      addChatMessage(project.id, "system", `Invalid graph, attempting repair: ${validation.errors.join("; ")}`);
      result = await provider.draftGraph({
        repoPath: repo.local_path,
        objective: project.objective,
        pinnedPaths: pinnedPaths ?? [],
        history,
        userMessage: message,
        previousTickets: previous?.tickets,
        repairErrors: validation.errors,
      });
      for (const call of result.toolCalls) addChatMessage(project.id, "tool", `${call.tag} ${call.text}`);
      validation = validateGraph(result.tickets);
    }

    addChatMessage(project.id, "assistant", result.assistantMessage || "(updated the plan)");

    if (!validation.ok) {
      addChatMessage(project.id, "system", `Repair failed, keeping previous version: ${validation.errors.join("; ")}`);
      res.status(422).json({ error: "Planner produced an invalid graph", errors: validation.errors });
      return;
    }

    insertGraphVersion(project.id, validation.tickets);
    res.json(projectState(project.id));
  } catch (err) {
    addChatMessage(project.id, "system", `Planner error: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

function mutateDraft(
  projectId: string,
  mutate: (tickets: DraftTicket[]) => DraftTicket[]
): { ok: true } | { ok: false; errors: string[] } {
  const latest = getLatestGraphVersion(projectId);
  const next = mutate(latest?.tickets ?? []);
  const validation = validateGraph(next);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  insertGraphVersion(projectId, validation.tickets);
  return { ok: true };
}

projectsRouter.patch("/:id/tickets/:ticketId", (req, res) => {
  const { title, problem, acceptanceCriteria, implementationNotes } = req.body as Partial<DraftTicket>;
  const result = mutateDraft(req.params.id, (tickets) =>
    tickets.map((t) =>
      t.id === req.params.ticketId
        ? {
            ...t,
            ...(title !== undefined ? { title } : {}),
            ...(problem !== undefined ? { problem } : {}),
            ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
            ...(implementationNotes !== undefined ? { implementationNotes } : {}),
          }
        : t
    )
  );
  if (!result.ok) {
    res.status(422).json({ error: "Edit produced an invalid graph", errors: result.errors });
    return;
  }
  res.json(projectState(req.params.id));
});

projectsRouter.post("/:id/tickets/:ticketId/dependencies", (req, res) => {
  const { dependsOn } = req.body as { dependsOn?: string };
  if (!dependsOn) {
    res.status(400).json({ error: "dependsOn is required" });
    return;
  }
  const result = mutateDraft(req.params.id, (tickets) =>
    tickets.map((t) =>
      t.id === req.params.ticketId && !t.dependsOn.includes(dependsOn)
        ? { ...t, dependsOn: [...t.dependsOn, dependsOn] }
        : t
    )
  );
  if (!result.ok) {
    res.status(422).json({ error: "Edit produced an invalid graph", errors: result.errors });
    return;
  }
  res.json(projectState(req.params.id));
});

projectsRouter.delete("/:id/tickets/:ticketId/dependencies/:depId", (req, res) => {
  const result = mutateDraft(req.params.id, (tickets) =>
    tickets.map((t) =>
      t.id === req.params.ticketId ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== req.params.depId) } : t
    )
  );
  if (!result.ok) {
    res.status(422).json({ error: "Edit produced an invalid graph", errors: result.errors });
    return;
  }
  res.json(projectState(req.params.id));
});

projectsRouter.delete("/:id/tickets/:ticketId", (req, res) => {
  const result = mutateDraft(req.params.id, (tickets) =>
    tickets
      .filter((t) => t.id !== req.params.ticketId)
      .map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== req.params.ticketId) }))
  );
  if (!result.ok) {
    res.status(422).json({ error: "Edit produced an invalid graph", errors: result.errors });
    return;
  }
  res.json(projectState(req.params.id));
});
