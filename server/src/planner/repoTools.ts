import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, relative } from "node:path";

// All tools are read-only and scoped to the connected repo's working tree —
// the planner must never be able to write files or escape the repo root.
function resolveScoped(repoPath: string, relPath: string): string {
  const target = normalize(join(repoPath, relPath || "."));
  const rel = relative(repoPath, target);
  if (rel.startsWith("..")) throw new Error("Path escapes repository root");
  return target;
}

export function listDir(repoPath: string, relPath: string): string[] {
  const dir = resolveScoped(repoPath, relPath);
  return readdirSync(dir).map((name) => {
    const isDir = statSync(join(dir, name)).isDirectory();
    return isDir ? `${name}/` : name;
  });
}

export function readFile(repoPath: string, relPath: string, maxBytes = 20_000): string {
  const file = resolveScoped(repoPath, relPath);
  const content = readFileSync(file, "utf8");
  return content.length > maxBytes ? `${content.slice(0, maxBytes)}\n…(truncated)` : content;
}

export function grep(repoPath: string, pattern: string, maxMatches = 50): string {
  try {
    const out = execFileSync(
      "git",
      ["grep", "-n", "--no-color", "-I", "-e", pattern],
      { cwd: repoPath, encoding: "utf8", maxBuffer: 1024 * 1024 }
    );
    const lines = out.split("\n").filter(Boolean);
    return lines.slice(0, maxMatches).join("\n") || "no matches";
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return "no matches";
    throw err;
  }
}

export function repoTree(repoPath: string, maxEntries = 400): string {
  const out = execFileSync("git", ["ls-files"], { cwd: repoPath, encoding: "utf8", maxBuffer: 1024 * 1024 });
  const lines = out.split("\n").filter(Boolean);
  return lines.slice(0, maxEntries).join("\n");
}
