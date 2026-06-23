-- 004_harness_profiles
--
-- Introduce named harness profiles so projects can run with different agent
-- harnesses (Claude Code, Codex, opencode, ...). Seeds three preset profiles,
-- wires up a global default, and drops the legacy `agent_command` setting with
-- no migration path.
--
-- This migration is written to be idempotent so it can run safely on every boot
-- on both fresh and upgraded databases. The `harness_profiles` table and the
-- `projects.harness_profile_id` column are created by schema.sql / migrate().

-- Seed the three preset profiles with stable, hardcoded ids so the global
-- default can reference one reliably.
INSERT OR IGNORE INTO harness_profiles (id, name, run_command, resume_command) VALUES
  (
    'claude-code-default',
    'Claude Code',
    'claude -p --dangerously-skip-permissions --session-id {sessionId}',
    'claude --resume {sessionId} --dangerously-skip-permissions'
  ),
  (
    'codex-default',
    'Codex',
    'codex exec {promptFile}',
    'codex exec resume {sessionId} {promptFile}'
  ),
  (
    'opencode-default',
    'opencode',
    'opencode run {promptFile}',
    NULL
  );

-- Point the global default at the Claude Code preset.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('default_harness_profile_id', 'claude-code-default');

-- Drop the legacy single-command setting. No data is preserved.
DELETE FROM settings WHERE key = 'agent_command';
