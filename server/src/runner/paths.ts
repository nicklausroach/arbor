import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ARBOR_HOME = process.env.ARBOR_HOME ?? join(homedir(), ".arbor");

export function worktreePath(projectId: string, ticketId: string): string {
  return join(ARBOR_HOME, "worktrees", projectId, ticketId);
}

// The Planner's per-project worktree, kept separate from per-ticket execution
// worktrees. Deterministic in projectId so it can be recreated at the same path
// (preserving Claude Code's session, which is keyed by cwd) and reaped without a
// stored path.
export function plannerWorktreePath(projectId: string): string {
  return join(ARBOR_HOME, "planner-worktrees", projectId);
}

// Relative path, inside the planner worktree, the plan.json is written to. Namespaced
// by project and version so turns never overwrite each other.
export function planFileRelPath(projectId: string, versionNumber: number): string {
  return join(".arbor", projectId, String(versionNumber), "plan.json");
}

export function logPath(runId: string): string {
  const dir = join(ARBOR_HOME, "logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${runId}.log`);
}
