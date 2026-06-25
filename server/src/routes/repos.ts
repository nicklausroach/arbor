import { execFile } from "node:child_process";
import { Router } from "express";
import { db } from "../db/index.js";
import {
  detectGitHubRemotes,
  findGitHubAppInstallationForOwner,
  getDefaultBranch,
  getGitHubAppInstallationUrl,
  isCleanWorkingTree,
  isGitRepo,
  GITHUB_PAT_ACCOUNT,
  pollGitHubDeviceLogin,
  startGitHubDeviceLogin,
  verifyGitHubAppInstallationRepo,
  verifyPat,
} from "../github/client.js";
import { newId } from "../id.js";
import { getSecret, setSecret } from "../keychain.js";
import { deleteRepository, listProjectsForRepository } from "../projects/store.js";
import { teardownPlannerSession } from "../planner/plannerSession.js";
import { teardownProjectWorktrees } from "../runner/worktree.js";

export const reposRouter = Router();

const githubLoginSessions = new Map<string, { deviceCode: string; expiresAt: number; interval: number }>();
const githubAppInstallSessions = new Map<
  string,
  { owner: string; name: string; expiresAt: number; installationId?: number; candidateInstallationId?: number; error?: string }
>();

interface RepositoryRow {
  id: string;
  local_path: string;
  owner: string;
  name: string;
  default_branch: string;
  created_at: string;
  github_installation_id: number | null;
}

type ExecFileForPicker = (
  file: string,
  args: string[],
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void;

function pickerCommand(platform: NodeJS.Platform): { file: string; args: string[] } | null {
  if (platform === "darwin") {
    return {
      file: "osascript",
      args: ["-e", 'POSIX path of (choose folder with prompt "Select local repository")'],
    };
  }
  if (platform === "win32") {
    return {
      file: "powershell",
      args: [
        "-NoProfile",
        "-Sta",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Select local repository'; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }",
      ],
    };
  }
  if (platform === "linux") {
    return {
      file: "sh",
      args: ["-c", "command -v zenity >/dev/null 2>&1 && zenity --file-selection --directory --title='Select local repository'"],
    };
  }
  return null;
}

function isPickerCancel(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes("user canceled") || message.includes("cancelled") || message.includes("canceled");
}

export async function pickRepositoryPath(
  platform: NodeJS.Platform = process.platform,
  execFileImpl: ExecFileForPicker = execFile
): Promise<string | null> {
  const command = pickerCommand(platform);
  if (!command) {
    throw new Error("Native directory selection is not supported on this platform.");
  }

  return new Promise((resolve, reject) => {
    execFileImpl(command.file, command.args, (error, stdout, stderr) => {
      if (error) {
        if (isPickerCancel(error)) {
          resolve(null);
          return;
        }
        reject(new Error(stderr.trim() || error.message));
        return;
      }

      const localPath = stdout.trim().replace(/[\\/]+$/, "");
      resolve(localPath || null);
    });
  });
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

reposRouter.post("/browse", async (_req, res) => {
  try {
    const localPath = await pickRepositoryPath();
    if (!localPath) {
      res.status(204).end();
      return;
    }
    res.json({ localPath });
  } catch (err) {
    res.status(501).json({ error: (err as Error).message });
  }
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

reposRouter.post("/github-login/start", async (_req, res) => {
  try {
    const login = await startGitHubDeviceLogin();
    const sessionId = newId("ghlogin");
    githubLoginSessions.set(sessionId, {
      deviceCode: login.deviceCode,
      expiresAt: login.expiresAt,
      interval: login.interval,
    });
    res.json({
      sessionId,
      userCode: login.userCode,
      verificationUri: login.verificationUri,
      expiresAt: login.expiresAt,
      interval: login.interval,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

reposRouter.post("/github-login/poll", async (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const session = githubLoginSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "GitHub login session not found. Start login again." });
    return;
  }
  if (Date.now() > session.expiresAt) {
    githubLoginSessions.delete(sessionId);
    res.json({ status: "expired" });
    return;
  }
  try {
    const result = await pollGitHubDeviceLogin(session.deviceCode);
    if (result.status === "pending") {
      if (result.interval) session.interval = result.interval;
      res.json({ status: "pending", interval: session.interval });
      return;
    }
    if (result.status === "expired") {
      githubLoginSessions.delete(sessionId);
      res.json({ status: "expired" });
      return;
    }
    setSecret(GITHUB_PAT_ACCOUNT, result.token);
    githubLoginSessions.delete(sessionId);
    res.json({ status: "authorized", login: result.login, scopes: result.scopes });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

reposRouter.post("/github-app/start", async (req, res) => {
  const { owner, name } = req.body as { owner?: string; name?: string };
  if (!owner || !name) {
    res.status(400).json({ error: "owner and name are required" });
    return;
  }
  try {
    const sessionId = newId("ghapp");
    const existingInstallation = await findGitHubAppInstallationForOwner(owner);
    githubAppInstallSessions.set(sessionId, {
      owner,
      name,
      expiresAt: Date.now() + 15 * 60 * 1000,
      candidateInstallationId: existingInstallation?.id,
    });
    const installationUrl = await getGitHubAppInstallationUrl(sessionId, existingInstallation?.accountId);
    res.json({ sessionId, installationUrl });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

reposRouter.get("/github-app/callback", async (req, res) => {
  const sessionId = typeof req.query.state === "string" ? req.query.state : undefined;
  const installationIdRaw = typeof req.query.installation_id === "string" ? req.query.installation_id : undefined;
  const session = sessionId ? githubAppInstallSessions.get(sessionId) : undefined;
  if (!sessionId || !session) {
    res.status(400).type("text/plain").send("GitHub App installation session not found. Return to Arbor and try again.");
    return;
  }
  if (Date.now() > session.expiresAt) {
    githubAppInstallSessions.delete(sessionId);
    res.status(400).type("text/plain").send("GitHub App installation session expired. Return to Arbor and try again.");
    return;
  }
  const installationId = Number(installationIdRaw);
  if (!Number.isInteger(installationId)) {
    session.error = "GitHub did not return an installation id. Try installing the app again.";
    res.status(400).type("text/plain").send(session.error);
    return;
  }
  try {
    await verifyGitHubAppInstallationRepo(installationId, session.owner, session.name);
    session.installationId = installationId;
    res.type("text/plain").send("GitHub App installed. You can close this tab and return to Arbor.");
  } catch (err) {
    session.error = `The GitHub App installation does not have access to ${session.owner}/${session.name}: ${(err as Error).message}`;
    res.status(400).type("text/plain").send(session.error);
  }
});

reposRouter.post("/github-app/poll", async (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const session = githubAppInstallSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "GitHub App installation session not found. Start installation again." });
    return;
  }
  if (Date.now() > session.expiresAt) {
    githubAppInstallSessions.delete(sessionId);
    res.json({ status: "expired" });
    return;
  }
  if (session.error) {
    res.status(400).json({ error: session.error });
    return;
  }
  if (session.installationId) {
    res.json({ status: "installed", installationId: session.installationId });
    return;
  }
  if (session.candidateInstallationId) {
    try {
      await verifyGitHubAppInstallationRepo(session.candidateInstallationId, session.owner, session.name);
      session.installationId = session.candidateInstallationId;
      res.json({ status: "installed", installationId: session.installationId });
      return;
    } catch {
      // The app installation exists, but GitHub has not granted this repository yet.
    }
  }
  res.json({ status: "pending" });
});

// Finalize connection: persist the repository row. GitHub App installations are
// stored per repository; PATs remain supported only as a legacy fallback.
reposRouter.post("/", async (req, res) => {
  const { localPath, owner, name, defaultBranch, token, githubInstallationId } = req.body as {
    localPath?: string;
    owner?: string;
    name?: string;
    defaultBranch?: string;
    token?: string;
    githubInstallationId?: number;
  };
  if (!localPath || !owner || !name || !defaultBranch) {
    res.status(400).json({ error: "localPath, owner, name, defaultBranch are required" });
    return;
  }
  if (githubInstallationId) {
    try {
      await verifyGitHubAppInstallationRepo(githubInstallationId, owner, name);
    } catch (err) {
      res.status(400).json({ error: `GitHub App installation verification failed: ${(err as Error).message}` });
      return;
    }
  } else if (token) {
    try {
      await verifyPat(token);
    } catch (err) {
      res.status(400).json({ error: `Token verification failed: ${(err as Error).message}` });
      return;
    }
    setSecret(GITHUB_PAT_ACCOUNT, token);
  } else if (!getSecret(GITHUB_PAT_ACCOUNT)) {
    res.status(400).json({ error: "Install the GitHub App before connecting a repository." });
    return;
  }
  const id = newId("repo");
  db.prepare(
    "INSERT INTO repositories (id, local_path, owner, name, default_branch, github_installation_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, localPath, owner, name, defaultBranch, githubInstallationId ?? null);
  const row = db.prepare("SELECT * FROM repositories WHERE id = ?").get(id);
  res.status(201).json(row);
});

reposRouter.delete("/:id", (req, res) => {
  const repo = db.prepare("SELECT * FROM repositories WHERE id = ?").get(req.params.id) as RepositoryRow | undefined;
  if (!repo) {
    res.status(404).json({ error: "repository not found" });
    return;
  }

  const projects = listProjectsForRepository(req.params.id);
  for (const project of projects) {
    teardownPlannerSession(project.id);
    // Remove execution worktrees while the repo row is still resolvable, so the helper
    // can run `git worktree remove` against the repo's local_path. Best-effort.
    teardownProjectWorktrees(project.id);
  }
  deleteRepository(req.params.id);
  res.json({ ok: true });
});

reposRouter.get("/auth-status", (_req, res) => {
  const token = getSecret(GITHUB_PAT_ACCOUNT);
  const appRepos = db.prepare("SELECT COUNT(*) AS count FROM repositories WHERE github_installation_id IS NOT NULL").get() as {
    count: number;
  };
  res.json({ connected: Boolean(token) || appRepos.count > 0 });
});
