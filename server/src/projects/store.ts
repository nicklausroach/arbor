import { db } from "../db/index.js";
import { newId } from "../id.js";
import type { DraftTicket } from "../planner/types.js";

export interface ProjectRow {
  id: string;
  repository_id: string;
  title: string;
  objective: string;
  status: "draft" | "approval_failed" | "approved" | "running" | "done";
  milestone_number: number | null;
  milestone_url: string | null;
  label_name: string;
  base_branch: string | null;
  created_at: string;
}

export interface RepositoryRow {
  id: string;
  local_path: string;
  owner: string;
  name: string;
  default_branch: string;
}

export function getRepository(id: string): RepositoryRow | undefined {
  return db.prepare("SELECT * FROM repositories WHERE id = ?").get(id) as RepositoryRow | undefined;
}

export function createProject(params: { repositoryId: string; title: string; objective: string }): ProjectRow {
  const id = newId("proj");
  db.prepare("INSERT INTO projects (id, repository_id, title, objective) VALUES (?, ?, ?, ?)").run(
    id,
    params.repositoryId,
    params.title,
    params.objective
  );
  return getProject(id)!;
}

export function deleteProject(id: string): void {
  db.prepare("DELETE FROM chat_messages WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM dependencies WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM runs WHERE ticket_id IN (SELECT id FROM tickets WHERE project_id = ?)").run(id);
  db.prepare("DELETE FROM tickets WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM graph_versions WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function getProject(id: string): ProjectRow | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

export function listProjects(): ProjectRow[] {
  return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[];
}

export function setProjectStatus(id: string, status: ProjectRow["status"]): void {
  db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(status, id);
}

export function setProjectMilestone(id: string, milestoneNumber: number, milestoneUrl: string): void {
  db.prepare("UPDATE projects SET milestone_number = ?, milestone_url = ? WHERE id = ?").run(
    milestoneNumber,
    milestoneUrl,
    id
  );
}

export function setProjectBaseBranch(id: string, baseBranch: string): void {
  db.prepare("UPDATE projects SET base_branch = ? WHERE id = ?").run(baseBranch, id);
}

interface GraphVersionRow {
  id: string;
  project_id: string;
  version_number: number;
  tickets_json: string;
  created_at: string;
}

export function getLatestGraphVersion(projectId: string): { versionNumber: number; tickets: DraftTicket[] } | undefined {
  const row = db
    .prepare("SELECT * FROM graph_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1")
    .get(projectId) as GraphVersionRow | undefined;
  if (!row) return undefined;
  return { versionNumber: row.version_number, tickets: JSON.parse(row.tickets_json) as DraftTicket[] };
}

export function listGraphVersions(projectId: string): { versionNumber: number; createdAt: string }[] {
  const rows = db
    .prepare("SELECT version_number, created_at FROM graph_versions WHERE project_id = ? ORDER BY version_number ASC")
    .all(projectId) as { version_number: number; created_at: string }[];
  return rows.map((r) => ({ versionNumber: r.version_number, createdAt: r.created_at }));
}

export function getGraphVersion(projectId: string, versionNumber: number): DraftTicket[] | undefined {
  const row = db
    .prepare("SELECT tickets_json FROM graph_versions WHERE project_id = ? AND version_number = ?")
    .get(projectId, versionNumber) as { tickets_json: string } | undefined;
  return row ? (JSON.parse(row.tickets_json) as DraftTicket[]) : undefined;
}

export function insertGraphVersion(projectId: string, tickets: DraftTicket[]): number {
  const latest = getLatestGraphVersion(projectId);
  const nextVersion = (latest?.versionNumber ?? 0) + 1;
  db.prepare(
    "INSERT INTO graph_versions (id, project_id, version_number, tickets_json) VALUES (?, ?, ?, ?)"
  ).run(newId("gv"), projectId, nextVersion, JSON.stringify(tickets));
  return nextVersion;
}

export interface ChatMessageRow {
  id: string;
  project_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  created_at: string;
}

export function addChatMessage(projectId: string, role: ChatMessageRow["role"], content: string): ChatMessageRow {
  const id = newId("msg");
  db.prepare("INSERT INTO chat_messages (id, project_id, role, content) VALUES (?, ?, ?, ?)").run(
    id,
    projectId,
    role,
    content
  );
  return db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as ChatMessageRow;
}

export function listChatMessages(projectId: string): ChatMessageRow[] {
  // Tie-break on rowid: rapid successive inserts within the same planner turn can
  // share a created_at millisecond, and only rowid reflects true insertion order.
  return db
    .prepare("SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(projectId) as ChatMessageRow[];
}

export interface TicketRow {
  id: string;
  project_id: string;
  stable_key: string;
  number: number;
  title: string;
  problem: string;
  acceptance_criteria_json: string;
  implementation_notes: string | null;
  status: "draft" | "blocked" | "ready" | "running" | "review" | "merged" | "failed";
  github_issue_number: number | null;
  github_issue_url: string | null;
  branch_name: string | null;
  created_at: string;
  updated_at: string;
}

// Ensures a tickets row exists for every ticket in the approved graph version, without
// clobbering github_issue_number/url already set by a previous (partially failed) approval
// attempt — this is what makes approval retry-safe.
export function ensureTicketRows(
  projectId: string,
  tickets: { ticket: DraftTicket; number: number; status: "blocked" | "ready"; branchName: string }[]
): void {
  const insert = db.prepare(
    `INSERT INTO tickets (id, project_id, stable_key, number, title, problem, acceptance_criteria_json, implementation_notes, status, branch_name)
     VALUES (@id, @projectId, @stableKey, @number, @title, @problem, @acceptanceCriteriaJson, @implementationNotes, @status, @branchName)
     ON CONFLICT(project_id, stable_key) DO NOTHING`
  );
  for (const { ticket, number, status, branchName } of tickets) {
    insert.run({
      id: newId("tkt"),
      projectId,
      stableKey: ticket.id,
      number,
      title: ticket.title,
      problem: ticket.problem,
      acceptanceCriteriaJson: JSON.stringify(ticket.acceptanceCriteria),
      implementationNotes: ticket.implementationNotes ?? null,
      status,
      branchName,
    });
  }
}

export function getTicketByStableKey(projectId: string, stableKey: string): TicketRow | undefined {
  return db.prepare("SELECT * FROM tickets WHERE project_id = ? AND stable_key = ?").get(projectId, stableKey) as
    | TicketRow
    | undefined;
}

export function getTicketById(ticketId: string): TicketRow | undefined {
  return db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId) as TicketRow | undefined;
}

export function listTickets(projectId: string): TicketRow[] {
  return db.prepare("SELECT * FROM tickets WHERE project_id = ? ORDER BY number ASC").all(projectId) as TicketRow[];
}

export function setTicketGithubIssue(ticketId: string, issueNumber: number, issueUrl: string): void {
  db.prepare(
    "UPDATE tickets SET github_issue_number = ?, github_issue_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
  ).run(issueNumber, issueUrl, ticketId);
}

export function setTicketStatus(ticketId: string, status: TicketRow["status"]): void {
  db.prepare(
    "UPDATE tickets SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
  ).run(status, ticketId);
}

export function insertDependencyRows(projectId: string, tickets: DraftTicket[]): void {
  const insert = db.prepare(
    `INSERT INTO dependencies (project_id, ticket_stable_key, depends_on_stable_key)
     VALUES (?, ?, ?) ON CONFLICT(project_id, ticket_stable_key, depends_on_stable_key) DO NOTHING`
  );
  for (const t of tickets) {
    for (const dep of t.dependsOn) insert.run(projectId, t.id, dep);
  }
}

export function listDependencies(projectId: string): { ticketStableKey: string; dependsOnStableKey: string }[] {
  const rows = db
    .prepare("SELECT ticket_stable_key, depends_on_stable_key FROM dependencies WHERE project_id = ?")
    .all(projectId) as { ticket_stable_key: string; depends_on_stable_key: string }[];
  return rows.map((r) => ({ ticketStableKey: r.ticket_stable_key, dependsOnStableKey: r.depends_on_stable_key }));
}

export interface TicketWithDeps extends TicketRow {
  dependsOn: string[];
}

export function listTicketsWithDeps(projectId: string): TicketWithDeps[] {
  const tickets = listTickets(projectId);
  const deps = listDependencies(projectId);
  const byKey = new Map<string, string[]>();
  for (const d of deps) byKey.set(d.ticketStableKey, [...(byKey.get(d.ticketStableKey) ?? []), d.dependsOnStableKey]);
  return tickets.map((t) => ({ ...t, dependsOn: byKey.get(t.stable_key) ?? [] }));
}

export function listRunningProjects(): ProjectRow[] {
  return db.prepare("SELECT * FROM projects WHERE status = 'running'").all() as ProjectRow[];
}

export interface RunRow {
  id: string;
  ticket_id: string;
  attempt_number: number;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  pr_number: number | null;
  pr_url: string | null;
  log_path: string | null;
  session_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export function countRunsForTicket(ticketId: string): number {
  const row = db.prepare("SELECT COUNT(*) as n FROM runs WHERE ticket_id = ?").get(ticketId) as { n: number };
  return row.n;
}

export function insertRun(ticketId: string, logPath: string, sessionId?: string): RunRow {
  const id = newId("run");
  const attemptNumber = countRunsForTicket(ticketId) + 1;
  db.prepare(
    "INSERT INTO runs (id, ticket_id, attempt_number, status, log_path, session_id, started_at) VALUES (?, ?, ?, 'running', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
  ).run(id, ticketId, attemptNumber, logPath, sessionId ?? null);
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow;
}

export function finishRun(
  runId: string,
  status: "succeeded" | "failed" | "cancelled",
  prNumber?: number,
  prUrl?: string
): void {
  db.prepare(
    "UPDATE runs SET status = ?, pr_number = ?, pr_url = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
  ).run(status, prNumber ?? null, prUrl ?? null, runId);
}

export function getLatestRunForTicket(ticketId: string): RunRow | undefined {
  return db
    .prepare("SELECT * FROM runs WHERE ticket_id = ? ORDER BY attempt_number DESC LIMIT 1")
    .get(ticketId) as RunRow | undefined;
}

export function listRunsForTicket(ticketId: string): RunRow[] {
  return db.prepare("SELECT * FROM runs WHERE ticket_id = ? ORDER BY attempt_number ASC").all(ticketId) as RunRow[];
}

export function getRun(runId: string): RunRow | undefined {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
}
