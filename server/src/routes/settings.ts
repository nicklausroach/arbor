import { Router } from "express";
import { db, getSetting, setSetting } from "../db/index.js";
import { GITHUB_PAT_ACCOUNT } from "../github/client.js";
import { getSecret } from "../keychain.js";
import { isClaudeAvailable } from "../runner/claudeBin.js";

export const settingsRouter = Router();

function hasGitHubAuth(): boolean {
  const appRepos = db.prepare("SELECT COUNT(*) AS count FROM repositories WHERE github_installation_id IS NOT NULL").get() as {
    count: number;
  };
  return Boolean(getSecret(GITHUB_PAT_ACCOUNT)) || appRepos.count > 0;
}

settingsRouter.get("/", (_req, res) => {
  res.json({
    githubConnected: hasGitHubAuth(),
    // The Planner runs on Claude Code's ambient auth; we can only confirm the binary
    // resolves. Real auth failures surface when a planning run is attempted.
    claudeAvailable: isClaudeAvailable(),
    agentCommand: getSetting("agent_command") ?? "claude -p --dangerously-skip-permissions",
    maxConcurrency: Number(getSetting("max_concurrency") ?? "1"),
  });
});

settingsRouter.put("/agent-command", (req, res) => {
  const { agentCommand } = req.body as { agentCommand?: string };
  if (!agentCommand) {
    res.status(400).json({ error: "agentCommand is required" });
    return;
  }
  setSetting("agent_command", agentCommand);
  res.json({ ok: true });
});

settingsRouter.put("/max-concurrency", (req, res) => {
  const { maxConcurrency } = req.body as { maxConcurrency?: number };
  if (!maxConcurrency || maxConcurrency < 1) {
    res.status(400).json({ error: "maxConcurrency must be >= 1" });
    return;
  }
  setSetting("max_concurrency", String(Math.floor(maxConcurrency)));
  res.json({ ok: true });
});
