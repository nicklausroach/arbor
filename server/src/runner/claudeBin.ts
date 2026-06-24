import { execFileSync } from "node:child_process";

let cachedClaudeBin: string | undefined;

// node-pty's posix_spawnp and plain spawn can both fail to resolve a bare command name
// depending on the parent process's PATH at spawn time, so resolve an absolute path up
// front and cache it.
export function resolveClaudeBin(): string {
  if (cachedClaudeBin) return cachedClaudeBin;
  try {
    cachedClaudeBin = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
  } catch {
    cachedClaudeBin = "claude"; // fall back to PATH lookup at spawn time
  }
  return cachedClaudeBin;
}

// Whether the claude CLI resolves at all — used to gate planning before we try to spawn.
export function isClaudeAvailable(): boolean {
  try {
    execFileSync("which", ["claude"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
