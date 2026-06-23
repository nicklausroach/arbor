import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import { db } from "../db/index.js";
import {
  detectGitHubRemotes,
  getDefaultBranch,
  isCleanWorkingTree,
  isGitRepo,
  GITHUB_PAT_ACCOUNT,
  verifyPat,
} from "../github/client.js";
import { newId } from "../id.js";
import { getSecret, setSecret } from "../keychain.js";
import { resolveBrowsePath } from "../fs/browse.js";

export const reposRouter = Router();

interface RepositoryRow {
  id: string;
  local_path: string;
  owner: string;
  name: string;
  default_branch: string;
  created_at: string;
}

reposRouter.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM repositories ORDER BY created_at DESC").all() as RepositoryRow[];
  res.json(rows);
});

// Step 1+2: inspect a local path — is it a git repo, is it clean, what GitHub remotes exist.
reposRouter.post("/inspect", (req, res) => {
  const { localPath } = req.body as { localPath?: string };
  if (!localPath) {
    res.status(400).json({ error: "localPath is required" });
    return;
  }
  if (!isGitRepo(localPath)) {
    res.status(400).json({ error: "Not a git repository", localPath });
    return;
  }
  const remotes = detectGitHubRemotes(localPath);
  const clean = isCleanWorkingTree(localPath);
  const defaultBranch = getDefaultBranch(localPath);
  const preferred = remotes.find((r) => r.remoteName === "origin") ?? remotes[0];
  res.json({ localPath, clean, defaultBranch, remotes, preferred });
});

// Step 3: verify a pasted GitHub PAT against the API; on success it's stored in the keychain
// by the caller via PATCH /api/repos/:id/token (after the repository row exists), or immediately
// here for a pre-flight check without persisting anything yet.
reposRouter.post("/verify-token", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }
  try {
    const { login, scopes } = await verifyPat(token);
    res.json({ ok: true, login, scopes });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// Finalize connection: persist the repository row and store the PAT in the OS keychain.
// v1 is single-user/single-token, so one PAT in the keychain backs all connected repositories.
reposRouter.post("/", async (req, res) => {
  const { localPath, owner, name, defaultBranch, token } = req.body as {
    localPath?: string;
    owner?: string;
    name?: string;
    defaultBranch?: string;
    token?: string;
  };
  if (!localPath || !owner || !name || !defaultBranch || !token) {
    res.status(400).json({ error: "localPath, owner, name, defaultBranch, token are required" });
    return;
  }
  try {
    await verifyPat(token);
  } catch (err) {
    res.status(400).json({ error: `Token verification failed: ${(err as Error).message}` });
    return;
  }
  setSecret(GITHUB_PAT_ACCOUNT, token);
  const id = newId("repo");
  db.prepare(
    "INSERT INTO repositories (id, local_path, owner, name, default_branch) VALUES (?, ?, ?, ?, ?)"
  ).run(id, localPath, owner, name, defaultBranch);
  const row = db.prepare("SELECT * FROM repositories WHERE id = ?").get(id);
  res.status(201).json(row);
});

interface BrowseEntry {
  name: string;
  type: "directory" | "file";
  isHidden: boolean;
  isGitRepo: boolean;
}

// Lists directories/files at a given filesystem path so the frontend can implement a repo
// picker. Defaults to the user's home directory. Paths are resolved against the home
// directory (never the server process's cwd) to avoid surprising traversal via relative input.
reposRouter.post("/browse", (req, res) => {
  const { path: requestedPath } = req.body as { path?: string };
  if (requestedPath !== undefined && typeof requestedPath !== "string") {
    res.status(400).json({ error: "path must be a string" });
    return;
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveBrowsePath(requestedPath);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      res.status(404).json({ error: "Path does not exist", path: resolvedPath });
    } else if (code === "EACCES" || code === "EPERM") {
      res.status(403).json({ error: "Permission denied", path: resolvedPath });
    } else {
      res.status(400).json({ error: "Unable to access path", path: resolvedPath });
    }
    return;
  }

  if (!stat.isDirectory()) {
    res.status(400).json({ error: "Path is not a directory", path: resolvedPath });
    return;
  }

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(resolvedPath, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      res.status(403).json({ error: "Permission denied", path: resolvedPath });
    } else {
      res.status(400).json({ error: "Unable to read directory", path: resolvedPath });
    }
    return;
  }

  const entries: BrowseEntry[] = dirents
    .filter((d) => d.isDirectory() || d.isFile())
    .map((d) => {
      const isHidden = d.name.startsWith(".");
      const type: "directory" | "file" = d.isDirectory() ? "directory" : "file";
      const entryPath = path.join(resolvedPath, d.name);
      return {
        name: d.name,
        type,
        isHidden,
        isGitRepo: type === "directory" ? isGitRepo(entryPath) : false,
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const parentPath = path.dirname(resolvedPath);
  res.json({
    path: resolvedPath,
    parentPath: parentPath === resolvedPath ? null : parentPath,
    entries,
  });
});

reposRouter.get("/auth-status", (_req, res) => {
  const token = getSecret(GITHUB_PAT_ACCOUNT);
  res.json({ connected: Boolean(token) });
});
