import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectWorktreesPath } from "./paths.js";
import { getProject, getRepository, listProjects } from "../projects/store.js";

// Idempotent: if the worktree directory already exists (e.g. a prior partial run),
// reuse it rather than failing — `git worktree add` would error on a duplicate branch.
export function ensureWorktree(repoPath: string, worktreeDir: string, branch: string, baseBranch: string): void {
  if (existsSync(worktreeDir)) return;
  const remoteBase = `refs/remotes/origin/${baseBranch}`;
  execFileSync("git", ["fetch", "origin", `+refs/heads/${baseBranch}:${remoteBase}`], { cwd: repoPath });
  mkdirSync(dirname(worktreeDir), { recursive: true });
  execFileSync("git", ["worktree", "add", worktreeDir, "-b", branch, remoteBase], { cwd: repoPath });
}

// Removes every execution worktree for a project: git bookkeeping (when the repo is
// resolvable) plus the on-disk directories, then the now-empty per-project dir.
// Best-effort: a missing directory, an unregistered worktree, or an unknown repo are all
// swallowed, so callers can invoke it unconditionally (e.g. on project deletion).
export function teardownProjectWorktrees(projectId: string): void {
  const base = projectWorktreesPath(projectId);
  let repoPath: string | undefined;
  try {
    const project = getProject(projectId);
    const repo = project ? getRepository(project.repository_id) : undefined;
    repoPath = repo?.local_path;
  } catch {
    // project row already gone or store unavailable — fall back to a raw delete
  }

  let children: string[] = [];
  try {
    children = readdirSync(base);
  } catch {
    // base dir doesn't exist — nothing registered or on disk
  }

  for (const child of children) {
    const dir = join(base, child);
    if (repoPath) {
      try {
        execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: repoPath });
      } catch {
        // worktree already gone or never registered — fall through to a raw delete
      }
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // nothing to remove
    }
  }

  // Remove the now-empty per-project dir so no stale folder is left behind.
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    // nothing to remove
  }
}

// On startup, reclaim execution worktrees orphaned by a crash, an interrupted deletion,
// or pre-existing data from before per-project teardown existed. Any per-project directory
// whose project no longer exists in the database is torn down; existing projects are left
// untouched. For true orphans the project row is already gone, so teardownProjectWorktrees
// falls back to a raw directory delete.
export function reapStaleExecutionWorktrees(): void {
  const base = dirname(projectWorktreesPath("_"));
  if (!existsSync(base)) return;
  const liveProjectIds = new Set(listProjects().map((p) => p.id));
  for (const projectId of readdirSync(base)) {
    if (liveProjectIds.has(projectId)) continue;
    teardownProjectWorktrees(projectId);
  }
}
