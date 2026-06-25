import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

// Loads the modules under test against a fresh, migrated database so listProjects()
// reflects rows we insert here.
async function loadWithDb(arborHome: string) {
  process.env.ARBOR_HOME = arborHome;
  process.env.ARBOR_DB_PATH = join(mkdtempSync(join(tmpdir(), "arbor-reap-db-")), "arbor.sqlite");
  vi.resetModules();
  const dbModule = await import("../db/index.js");
  dbModule.migrate();
  const paths = await import("./paths.js");
  const worktree = await import("./worktree.js");
  const store = await import("../projects/store.js");
  return { ...dbModule, ...paths, ...worktree, ...store };
}

describe("reapStaleExecutionWorktrees", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reaps a deleted project's worktrees while preserving an existing project's", async () => {
    const root = mkdtempSync(join(tmpdir(), "arbor-reap-"));
    const arborHome = join(root, "home");

    const { db, worktreePath, reapStaleExecutionWorktrees, createProject } = await loadWithDb(arborHome);

    db.prepare(
      "INSERT INTO repositories (id, local_path, owner, name, default_branch) VALUES (?, ?, ?, ?, ?)"
    ).run("repo_reap", "/tmp/repo", "acme", "widgets", "main");
    const live = createProject({ repositoryId: "repo_reap", title: "live", objective: "stay" });

    // A worktree dir for the existing project, plus one for a project that no longer exists.
    const liveDir = worktreePath(live.id, "tkt_live");
    const staleDir = worktreePath("proj_deleted", "tkt_stale");
    mkdirSync(liveDir, { recursive: true });
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(liveDir, "keep.txt"), "keep\n");
    writeFileSync(join(staleDir, "drop.txt"), "drop\n");

    reapStaleExecutionWorktrees();

    expect(existsSync(liveDir)).toBe(true);
    expect(existsSync(staleDir)).toBe(false);
  });

  it("is a no-op (does not throw) when the worktrees base dir does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "arbor-reap-noop-"));
    const arborHome = join(root, "home");

    const { reapStaleExecutionWorktrees, projectWorktreesPath } = await loadWithDb(arborHome);

    expect(existsSync(dirname(projectWorktreesPath("_")))).toBe(false);
    expect(() => reapStaleExecutionWorktrees()).not.toThrow();
  });
});
