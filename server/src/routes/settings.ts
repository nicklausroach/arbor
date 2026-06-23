import { Router } from "express";
import { getSetting, setSetting } from "../db/index.js";
import { GITHUB_PAT_ACCOUNT } from "../github/client.js";
import { deleteSecret, getSecret, setSecret } from "../keychain.js";

export const settingsRouter = Router();

export const ANTHROPIC_KEY_ACCOUNT = "anthropic-api-key";

export function getAnthropicKey(): string | undefined {
  return getSecret(ANTHROPIC_KEY_ACCOUNT);
}

settingsRouter.get("/", (_req, res) => {
  res.json({
    githubConnected: Boolean(getSecret(GITHUB_PAT_ACCOUNT)),
    anthropicConnected: Boolean(getSecret(ANTHROPIC_KEY_ACCOUNT)),
    agentCommand: getSetting("agent_command") ?? "claude -p --dangerously-skip-permissions",
    maxConcurrency: Number(getSetting("max_concurrency") ?? "1"),
  });
});

settingsRouter.put("/anthropic-key", (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey) {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }
  setSecret(ANTHROPIC_KEY_ACCOUNT, apiKey);
  res.json({ ok: true });
});

settingsRouter.delete("/anthropic-key", (_req, res) => {
  deleteSecret(ANTHROPIC_KEY_ACCOUNT);
  res.json({ ok: true });
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
