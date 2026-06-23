import { execFileSync } from "node:child_process";
import * as pty from "node-pty";

const sessions = new Map<string, pty.IPty>();

let cachedClaudeBin: string | undefined;
function resolveClaudeBin(): string {
  if (cachedClaudeBin) return cachedClaudeBin;
  try {
    cachedClaudeBin = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
  } catch {
    cachedClaudeBin = "claude"; // fall back to PATH lookup at spawn time
  }
  return cachedClaudeBin;
}

// node-pty's posix_spawnp can fail to resolve a bare command name depending on the
// parent process's PATH at spawn time, so resolve an absolute path up front. Spawn
// errors must never escape this function uncaught — node-pty throws synchronously
// on spawn failure, and an uncaught throw here would crash the whole server process.
export function spawnSession(runId: string, cwd: string, sessionId: string): pty.IPty {
  const existing = sessions.get(runId);
  if (existing) return existing;

  const term = pty.spawn(resolveClaudeBin(), ["--resume", sessionId, "--dangerously-skip-permissions"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env as Record<string, string>,
  });
  sessions.set(runId, term);
  term.onExit(() => sessions.delete(runId));
  return term;
}

export function endSession(runId: string): void {
  const term = sessions.get(runId);
  if (!term) return;
  // node-pty's default kill signal (SIGHUP) doesn't reliably terminate the Claude
  // CLI under a pty — force-kill, and fall back to killing the OS pid directly if
  // the pty wrapper's kill doesn't take.
  try {
    term.kill("SIGKILL");
  } catch {
    // process may already be gone
  }
  sessions.delete(runId);
}
