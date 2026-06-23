import os from "node:os";
import path from "node:path";

/**
 * Resolves a user-supplied browse path to a safe, absolute, normalized path.
 * Relative paths and "." are resolved against the home directory (never the
 * server process's cwd) so a relative input can't be used to reach an
 * unrelated part of the filesystem the caller didn't intend.
 */
export function resolveBrowsePath(input: string | undefined | null): string {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (trimmed.includes("\0")) {
    throw new Error("Path contains invalid characters");
  }
  const base = trimmed.length > 0 ? trimmed : os.homedir();
  const expanded = base === "~" || base.startsWith("~/") ? path.join(os.homedir(), base.slice(1)) : base;
  return path.resolve(os.homedir(), expanded);
}
