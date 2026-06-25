import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function commit(cwd: string, message: string) {
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", message]);
}

// paths.ts captures ARBOR_HOME at module load, so each test sets a fresh temp ARBOR_HOME
// and resets the module registry before importing the code under test.
async function load(arborHome: string) {
  process.env.ARBOR_HOME = arborHome;
  // A throwaway db path so importing the store (eager Database open) never touches a real db.
  process.env.ARBOR_DB_PATH = join(mkdtempSync(join(tmpdir(), "arbor-teardown-db-")), "arbor.sqlite");
  vi.resetModules();
  const paths = await import("./paths.js");
  const worktree = await import("./worktree.js");
  return { ...paths, ...worktree };
}

describe("teardownProjectWorktrees", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("removes every worktree directory and the empty per-project dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "arbor-teardown-"));
    const arborHome = join(root, "home");
    const repo = join(root, "repo");

    git(root, ["init", "-b", "main", repo]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test User"]);
    writeFileSync(join(repo, "value.txt"), "base\n");
    commit(repo, "base");

    const { worktreePath, projectWorktreesPath, teardownProjectWorktrees } = await load(arborHome);

    const projectId = "proj_teardown";
    const a = worktreePath(projectId, "tkt_a");
    const b = worktreePath(projectId, "tkt_b");
    mkdirSync(projectWorktreesPath(projectId), { recursive: true });
    // Register them as real git worktrees so removal mirrors the production layout.
    git(repo, ["worktree", "add", "--detach", a, "main"]);
    git(repo, ["worktree", "add", "--detach", b, "main"]);

    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);

    teardownProjectWorktrees(projectId);

    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
    expect(existsSync(projectWorktreesPath(projectId))).toBe(false);
  });

  it("is a no-op (does not throw) when the project dir does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "arbor-teardown-noop-"));
    const arborHome = join(root, "home");

    const { projectWorktreesPath, teardownProjectWorktrees } = await load(arborHome);

    expect(existsSync(projectWorktreesPath("proj_missing"))).toBe(false);
    expect(() => teardownProjectWorktrees("proj_missing")).not.toThrow();
  });
});
