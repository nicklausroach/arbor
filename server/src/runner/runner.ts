import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import type { Octokit } from "octokit";
import { findOpenPrForBranch } from "../github/client.js";
import {
  finishRun,
  insertRun,
  setTicketStatus,
  type ProjectRow,
  type RepositoryRow,
  type TicketWithDeps,
} from "../projects/store.js";
import { buildAgentPrompt, type DependencyRef } from "./prompt.js";
import { parsePrUrl } from "./parsePr.js";
import { logPath, worktreePath } from "./paths.js";
import { ensureWorktree } from "./worktree.js";

export function startTicketRun(params: {
  project: ProjectRow;
  repo: RepositoryRow;
  ticket: TicketWithDeps;
  dependencyRefs: DependencyRef[];
  agentCommand: string;
  octokit: Octokit;
}): void {
  const { project, repo, ticket, dependencyRefs, agentCommand, octokit } = params;
  const runLogPath = logPath(ticket.id + "-" + Date.now());
  // Session resume ("Connect to session") is Claude Code-specific; only attach a
  // --session-id when the configured agent command actually invokes claude.
  const isClaudeAgent = /^\s*claude\b/.test(agentCommand);
  const sessionId = isClaudeAgent ? randomUUID() : undefined;
  const run = insertRun(ticket.id, runLogPath, sessionId);
  const spawnCommand = sessionId ? `${agentCommand} --session-id ${sessionId}` : agentCommand;
  setTicketStatus(ticket.id, "running");

  const worktreeDir = worktreePath(project.id, ticket.id);
  try {
    ensureWorktree(repo.local_path, worktreeDir, ticket.branch_name!, project.base_branch!);
  } catch (err) {
    writeFileSync(runLogPath, `Failed to create worktree: ${(err as Error).message}\n`);
    finishRun(run.id, "failed");
    setTicketStatus(ticket.id, "failed");
    return;
  }

  const prompt = buildAgentPrompt({
    ticket,
    issueUrl: ticket.github_issue_url!,
    branch: ticket.branch_name!,
    baseBranch: project.base_branch!,
    acceptanceCriteria: JSON.parse(ticket.acceptance_criteria_json) as string[],
    dependencyRefs,
  });

  writeFileSync(runLogPath, `$ ${spawnCommand}\n(cwd: ${worktreeDir})\n\n`);

  let output = "";
  const child = spawn(spawnCommand, { cwd: worktreeDir, shell: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.write(prompt);
  child.stdin.end();
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    appendFileSync(runLogPath, chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    appendFileSync(runLogPath, chunk);
  });

  child.on("error", (err) => {
    appendFileSync(runLogPath, `\nProcess error: ${err.message}\n`);
    finishRun(run.id, "failed");
    setTicketStatus(ticket.id, "failed");
  });

  child.on("close", async () => {
    let pr = parsePrUrl(output, repo.owner, repo.name);
    if (!pr) {
      try {
        const found = await findOpenPrForBranch(octokit, repo.owner, repo.name, ticket.branch_name!);
        if (found) pr = found;
      } catch {
        // fall through to failure below
      }
    }
    if (!pr) {
      appendFileSync(runLogPath, "\nNo pull request found after agent exit — marking run failed.\n");
      finishRun(run.id, "failed");
      setTicketStatus(ticket.id, "failed");
      return;
    }
    finishRun(run.id, "succeeded", pr.number, pr.url);
    setTicketStatus(ticket.id, "review");
  });
}
