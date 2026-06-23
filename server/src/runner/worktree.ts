import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Idempotent: if the worktree directory already exists (e.g. a prior partial run),
// reuse it rather than failing — `git worktree add` would error on a duplicate branch.
export function ensureWorktree(repoPath: string, worktreeDir: string, branch: string, baseBranch: string): void {
  if (existsSync(worktreeDir)) return;
  mkdirSync(dirname(worktreeDir), { recursive: true });
  execFileSync("git", ["worktree", "add", worktreeDir, "-b", branch, baseBranch], { cwd: repoPath });
}
