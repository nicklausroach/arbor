import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ARBOR_HOME = process.env.ARBOR_HOME ?? join(homedir(), ".arbor");

export function worktreePath(projectId: string, ticketId: string): string {
  return join(ARBOR_HOME, "worktrees", projectId, ticketId);
}

export function logPath(runId: string): string {
  const dir = join(ARBOR_HOME, "logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${runId}.log`);
}
