import { Router } from "express";
import { octokitFromStoredPat, createIssue, createMilestone, ensureLabel } from "../github/client.js";
import { topoOrder } from "../planner/topo.js";
import type { DraftTicket } from "../planner/types.js";
import { validateGraph } from "../planner/validate.js";
import {
  ensureTicketRows,
  getLatestGraphVersion,
  getProject,
  getRepository,
  getTicketByStableKey,
  insertDependencyRows,
  listTickets,
  setProjectBaseBranch,
  setProjectMilestone,
  setProjectStatus,
  setTicketGithubIssue,
} from "../projects/store.js";
import { shortId, slugify } from "../projects/slug.js";

export const approveRouter = Router();

function buildIssueBody(
  ticket: DraftTicket,
  dependencyIssues: { ticket: DraftTicket; number: number; url: string }[]
): string {
  const lines = [ticket.problem, "", "## Acceptance criteria", ...ticket.acceptanceCriteria.map((a) => `- [ ] ${a}`)];
  if (ticket.implementationNotes) {
    lines.push("", "## Implementation notes (non-binding)", ticket.implementationNotes);
  }
  if (dependencyIssues.length) {
    lines.push("", "## Depends on", ...dependencyIssues.map((d) => `- #${d.number} ${d.ticket.title}`));
  }
  lines.push("", "---", "_Created and tracked by Arbor._");
  return lines.join("\n");
}

approveRouter.post("/:id/approve", async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  if (project.status !== "draft" && project.status !== "approval_failed") {
    res.status(400).json({ error: `project is already ${project.status}` });
    return;
  }
  const latest = getLatestGraphVersion(project.id);
  if (!latest || latest.tickets.length === 0) {
    res.status(400).json({ error: "no draft tickets to approve" });
    return;
  }
  const validation = validateGraph(latest.tickets);
  if (!validation.ok) {
    res.status(422).json({ error: "current graph is invalid", errors: validation.errors });
    return;
  }
  const repo = getRepository(project.repository_id);
  if (!repo) {
    res.status(404).json({ error: "repository not found" });
    return;
  }
  const octokit = octokitFromStoredPat();
  if (!octokit) {
    res.status(400).json({ error: "No GitHub token configured. Connect a repo first." });
    return;
  }

  const { startNow } = req.body as { startNow?: boolean };
  const ordered = topoOrder(validation.tickets);

  try {
    await ensureLabel(octokit, repo.owner, repo.name, project.label_name);

    let milestoneNumber = project.milestone_number;
    let milestoneUrl = project.milestone_url;
    if (!milestoneNumber) {
      const milestone = await createMilestone(
        octokit,
        repo.owner,
        repo.name,
        `arbor: ${project.title} (${shortId(project.id)})`
      );
      milestoneNumber = milestone.number;
      milestoneUrl = milestone.url;
      setProjectMilestone(project.id, milestoneNumber, milestoneUrl);
    }

    const projectSlug = slugify(project.title);
    const rootIds = new Set(validation.tickets.filter((t) => t.dependsOn.length === 0).map((t) => t.id));
    ensureTicketRows(
      project.id,
      ordered.map((ticket, i) => ({
        ticket,
        number: i + 1,
        status: rootIds.has(ticket.id) ? "ready" : "blocked",
        branchName: `arbor/${projectSlug}/${i + 1}-${slugify(ticket.title)}`,
      }))
    );
    insertDependencyRows(project.id, validation.tickets);
    setProjectBaseBranch(project.id, repo.default_branch);

    const createdIssues = new Map<string, { ticket: DraftTicket; number: number; url: string }>();
    for (const ticket of ordered) {
      const row = getTicketByStableKey(project.id, ticket.id)!;
      if (row.github_issue_number) {
        createdIssues.set(ticket.id, { ticket, number: row.github_issue_number, url: row.github_issue_url! });
        continue;
      }
      const dependencyIssues = ticket.dependsOn.map((d) => createdIssues.get(d)!).filter(Boolean);
      const body = buildIssueBody(ticket, dependencyIssues);
      const issue = await createIssue(octokit, repo.owner, repo.name, {
        title: ticket.title,
        body,
        labels: [project.label_name],
        milestone: milestoneNumber!,
      });
      setTicketGithubIssue(row.id, issue.number, issue.url);
      createdIssues.set(ticket.id, { ticket, number: issue.number, url: issue.url });
    }

    setProjectStatus(project.id, startNow ? "running" : "approved");
    res.json({ project: getProject(project.id), tickets: listTickets(project.id) });
  } catch (err) {
    setProjectStatus(project.id, "approval_failed");
    res.status(500).json({
      error: `Approval failed: ${(err as Error).message}. Already-created issues are preserved — retry will skip them.`,
      project: getProject(project.id),
      tickets: listTickets(project.id),
    });
  }
});

approveRouter.get("/:id/tickets", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(listTickets(project.id));
});
