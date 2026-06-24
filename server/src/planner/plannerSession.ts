import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { plannerWorktreePath } from "../runner/paths.js";
import { clearPlannerSession, getProject, getRepository, listProjects } from "../projects/store.js";

// One in-flight planning run per project. The planning session is resumed against a
// single on-disk worktree, so two concurrent runs would corrupt each other.
const inFlight = new Set<string>();

export function tryAcquirePlannerLock(projectId: string): boolean {
  if (inFlight.has(projectId)) return false;
  inFlight.add(projectId);
  return true;
}

export function releasePlannerLock(projectId: string): void {
  inFlight.delete(projectId);
}

// Idempotent: reuse the worktree if it already exists (which preserves Claude Code's
// session, keyed by cwd), else create a detached worktree off the base branch. Detached
// HEAD avoids any branch bookkeeping — the Planner never commits.
export function ensurePlannerWorktree(repoPath: string, projectId: string, baseBranch: string): string {
  const dir = plannerWorktreePath(projectId);
  if (existsSync(dir)) return dir;
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync("git", ["worktree", "add", "--detach", dir, baseBranch], { cwd: repoPath });
  return dir;
}

// Removes the worktree (git bookkeeping + directory) and clears the persisted session.
// Best-effort: a missing worktree or unknown repo must not throw.
export function teardownPlannerSession(projectId: string): void {
  const dir = plannerWorktreePath(projectId);
  const project = getProject(projectId);
  const repo = project ? getRepository(project.repository_id) : undefined;
  if (repo) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: repo.local_path });
    } catch {
      // worktree already gone or never registered — fall through to a raw delete
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // nothing to remove
  }
  if (project) clearPlannerSession(projectId);
}

// On startup, reclaim planner worktrees for projects that are gone or no longer drafting.
// Orphaned git metadata in the source repo is pruned the next time that repo is touched.
export function reapStalePlannerWorktrees(): void {
  const base = dirname(plannerWorktreePath("_"));
  if (!existsSync(base)) return;
  const activeDraftIds = new Set(listProjects().filter((p) => p.status === "draft").map((p) => p.id));
  for (const projectId of readdirSync(base)) {
    if (activeDraftIds.has(projectId)) continue;
    teardownPlannerSession(projectId);
  }
}
