import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureWorktree } from "./worktree.js";

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function commit(cwd: string, message: string) {
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", message]);
}

describe("ensureWorktree", () => {
  it("bases a new ticket worktree on the latest remote base branch", () => {
    const root = mkdtempSync(join(tmpdir(), "arbor-worktree-test-"));
    const source = join(root, "source");
    const remote = join(root, "remote.git");
    const repo = join(root, "repo");
    const worktree = join(root, "ticket-worktree");

    git(root, ["init", "-b", "main", source]);
    git(source, ["config", "user.email", "test@example.com"]);
    git(source, ["config", "user.name", "Test User"]);
    writeFileSync(join(source, "value.txt"), "base\n");
    commit(source, "base");
    git(root, ["clone", "--bare", source, remote]);
    git(root, ["clone", remote, repo]);

    writeFileSync(join(source, "value.txt"), "latest\n");
    commit(source, "latest");
    git(source, ["push", remote, "main"]);

    ensureWorktree(repo, worktree, "arbor/test-ticket", "main");

    expect(readFileSync(join(worktree, "value.txt"), "utf8")).toBe("latest\n");
  });
});
