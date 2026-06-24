import { execFile } from "node:child_process";
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

export const reposRouter = Router();

interface RepositoryRow {
  id: string;
  local_path: string;
  owner: string;
  name: string;
  default_branch: string;
  created_at: string;
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

reposRouter.get("/auth-status", (_req, res) => {
  const token = getSecret(GITHUB_PAT_ACCOUNT);
  res.json({ connected: Boolean(token) });
});
