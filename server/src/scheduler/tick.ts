import { getSetting } from "../db/index.js";
import { findOpenPrForBranch, getPrMergeState, octokitForRepository } from "../github/client.js";
import { startTicketRun } from "../runner/runner.js";
import {
  finishRun,
  getLatestRunForTicket,
  getProject,
  getRepository,
  listTicketsWithDeps,
  setProjectStatus,
  setTicketStatus,
  type TicketWithDeps,
} from "../projects/store.js";

export async function tick(projectId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project || project.status !== "running") return;
  const repo = getRepository(project.repository_id);
  if (!repo) return;
  const octokit = await octokitForRepository(repo);
  if (!octokit) return;

  // 0. Recover tickets left "running" by a server restart mid-run, or "failed" tickets
  // that may have created a PR: the in-memory process handle is gone, but the agent may
  // have already pushed a PR. Readiness is recomputed from persisted DAG + live PR state.
  for (const t of listTicketsWithDeps(projectId).filter((t) => t.status === "running" || t.status === "failed")) {
    const run = getLatestRunForTicket(t.id);
    if (!run || !t.branch_name) continue;
    if (t.status === "running" && run.status !== "running") continue;
    try {
      const pr = await findOpenPrForBranch(octokit, repo.owner, repo.name, t.branch_name);
      if (pr) {
        if (run.status !== "succeeded") {
          finishRun(run.id, "succeeded", pr.number, pr.url);
        }
        if (t.status === "running" || t.status === "failed") {
          setTicketStatus(t.id, "review");
        }
      }
    } catch {
      // transient GitHub error — leave as is, next tick retries
    }
  }

  // 1. Promote review -> merged by polling the linked PR.
  for (const t of listTicketsWithDeps(projectId).filter((t) => t.status === "review")) {
    const run = getLatestRunForTicket(t.id);
    if (!run?.pr_number) continue;
    try {
      const state = await getPrMergeState(octokit, repo.owner, repo.name, run.pr_number);
      if (state.merged) setTicketStatus(t.id, "merged");
    } catch {
      // transient GitHub error — leave in review, next tick retries
    }
  }

  // 2. Promote blocked -> ready once every upstream ticket is merged.
  let tickets = listTicketsWithDeps(projectId);
  const byKey = new Map(tickets.map((t) => [t.stable_key, t]));
  for (const t of tickets.filter((t) => t.status === "blocked")) {
    const upstreamMerged = t.dependsOn.every((dep) => byKey.get(dep)?.status === "merged");
    if (upstreamMerged) setTicketStatus(t.id, "ready");
  }

  // 3. Dispatch ready tickets up to the concurrency limit.
  tickets = listTicketsWithDeps(projectId);
  const maxConcurrency = Number(getSetting("max_concurrency") ?? "1");
  const agentCommand = getSetting("agent_command") ?? "claude -p --dangerously-skip-permissions";
  let runningCount = tickets.filter((t) => t.status === "running").length;
  const byKey2 = new Map(tickets.map((t) => [t.stable_key, t]));
  for (const t of tickets.filter((t) => t.status === "ready")) {
    if (runningCount >= maxConcurrency) break;
    const dependencyRefs = t.dependsOn.map((dep) => dependencyRef(byKey2.get(dep)));
    startTicketRun({ project, repo, ticket: t, dependencyRefs, agentCommand, octokit });
    runningCount++;
  }

  // 4. Project is done once every ticket has merged.
  tickets = listTicketsWithDeps(projectId);
  if (tickets.length > 0 && tickets.every((t) => t.status === "merged")) {
    setProjectStatus(projectId, "done");
  }
}

function dependencyRef(t: TicketWithDeps | undefined) {
  if (!t) return { title: "(unknown)", issueUrl: null, prUrl: null };
  const run = getLatestRunForTicket(t.id);
  return { title: t.title, issueUrl: t.github_issue_url, prUrl: run?.pr_url ?? null };
}
