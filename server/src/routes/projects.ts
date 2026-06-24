import { Router } from "express";
import { ClaudeCodePlannerProvider } from "../planner/claudeCode.js";
import { MalformedPlannerOutputError } from "../planner/planParse.js";
import type { PlannerEvent } from "../planner/llm.js";
import type { DraftTicket } from "../planner/types.js";
import { validateGraph } from "../planner/validate.js";
import {
  releasePlannerLock,
  teardownPlannerSession,
  tryAcquirePlannerLock,
} from "../planner/plannerSession.js";
import { isClaudeAvailable } from "../runner/claudeBin.js";
import { plannerWorktreePath } from "../runner/paths.js";
import {
  addChatMessage,
  createProject,
  deleteProject,
  getLatestGraphVersion,
  getProject,
  getRepository,
  insertGraphVersion,
  listChatMessages,
  listGraphVersions,
  listProjects,
  setPlannerSession,
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
  // No chat message is seeded here — the client kicks off planning by sending the
  // objective as the first chat message through the normal /chat stream, so the very
  // first turn runs through the exact same code path as every later message.
  const project = createProject({ repositoryId, title, objective });
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

projectsRouter.delete("/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  teardownPlannerSession(req.params.id);
  deleteProject(req.params.id);
  res.json({ ok: true });
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
  if (!isClaudeAvailable()) {
    res.status(400).json({ error: "Claude Code (claude) is not installed or not on PATH. Install it to plan." });
    return;
  }
  const { message, pinnedPaths } = req.body as { message?: string; pinnedPaths?: string[] };
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (!tryAcquirePlannerLock(project.id)) {
    res.status(409).json({ error: "Planning is already in progress for this project." });
    return;
  }

  // Captured before the new user message is inserted — the new message is sent to the
  // planner separately as `userMessage`, so including it in `history` too would duplicate it.
  const history = listChatMessages(project.id)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const previous = getLatestGraphVersion(project.id);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  const onEvent = (event: PlannerEvent) => {
    if (event.type === "text_delta") {
      send({ type: "text_delta", text: event.text });
    } else if (event.type === "text") {
      send({ type: "message", message: addChatMessage(project.id, "assistant", event.text) });
    } else {
      send({ type: "message", message: addChatMessage(project.id, "tool", `${event.tag} ${event.text}`) });
    }
  };

  const provider = new ClaudeCodePlannerProvider();
  const nextVersion = (previous?.versionNumber ?? 0) + 1;
  let sessionId = project.planner_session_id ?? undefined;

  try {
    send({ type: "message", message: addChatMessage(project.id, "user", message) });

    const draftGraph = async (repairErrors: string[] | undefined) => {
      const r = await provider.draftGraph({
        projectId: project.id,
        repoPath: repo.local_path,
        baseBranch: repo.default_branch,
        objective: project.objective,
        pinnedPaths: pinnedPaths ?? [],
        history,
        userMessage: message,
        previousTickets: previous?.tickets,
        repairErrors,
        versionNumber: nextVersion,
        sessionId,
        onEvent,
      });
      // Persist the session as soon as a run completes, so the repair call below and the
      // next planning turn resume it instead of starting cold.
      sessionId = r.sessionId;
      setPlannerSession(project.id, r.sessionId, plannerWorktreePath(project.id));
      return r;
    };

    let result: Awaited<ReturnType<typeof draftGraph>> | undefined;
    let repairErrors: string[] | undefined;
    let tickets: DraftTicket[] | undefined;

    try {
      result = await draftGraph(undefined);
    } catch (err) {
      if (!(err instanceof MalformedPlannerOutputError)) throw err;
      repairErrors = err.errors;
    }

    if (result) {
      const validation = validateGraph(result.tickets);
      if (validation.ok) tickets = validation.tickets;
      else repairErrors = validation.errors;
    }

    if (repairErrors) {
      send({ type: "message", message: addChatMessage(project.id, "system", `Invalid graph, attempting repair: ${repairErrors.join("; ")}`) });
      try {
        result = await draftGraph(repairErrors);
      } catch (err) {
        if (!(err instanceof MalformedPlannerOutputError)) throw err;
        send({ type: "message", message: addChatMessage(project.id, "system", `Repair failed, keeping previous version: ${err.errors.join("; ")}`) });
        send({ type: "error", error: "Planner produced a malformed graph", errors: err.errors });
        res.end();
        return;
      }
      const validation = validateGraph(result.tickets);
      if (!validation.ok) {
        send({ type: "message", message: addChatMessage(project.id, "system", `Repair failed, keeping previous version: ${validation.errors.join("; ")}`) });
        send({ type: "error", error: "Planner produced an invalid graph", errors: validation.errors });
        res.end();
        return;
      }
      tickets = validation.tickets;
    }

    if (!result || !tickets) throw new Error("Planner did not produce a graph");

    if (!result.assistantMessage.trim()) {
      send({ type: "message", message: addChatMessage(project.id, "assistant", "Updated the plan.") });
    }
    insertGraphVersion(project.id, tickets);
    send({ type: "done", state: projectState(project.id) });
    res.end();
  } catch (err) {
    send({ type: "message", message: addChatMessage(project.id, "system", `Planner error: ${(err as Error).message}`) });
    send({ type: "error", error: (err as Error).message });
    res.end();
  } finally {
    releasePlannerLock(project.id);
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
