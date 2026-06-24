# Drive the Planner with Claude Code instead of a direct Anthropic API call

## Status

accepted

## Context

The Planner originally ran as a bespoke Anthropic API agent loop (`anthropicProvider.ts`): a hand-rolled tool loop with read-only repo tools (`repoTools.ts`), a `propose_graph` structured-output tool, and an independent plan reviewer (`planReviewer.ts`). It authenticated with a separate Anthropic API key stored in Settings, deliberately kept distinct from the Harness credential.

We want plans that are more grounded in the actual codebase. Claude Code is a stronger code explorer than the hand-rolled read tools, so we replace the API planner with a Claude Code-driven one.

## Decision

The Planner is a Claude Code session. Each planning message runs a one-shot `claude -p --resume <session-id> --output-format stream-json` in an isolated git worktree off the repo's default branch; Claude Code researches the repo with its own tools and writes the plan to `.arbor/<project-id>/<version>/plan.json`, which Arbor reads, validates (`validateGraph`), and repairs (one round) exactly as before. The `PlannerProvider` interface, plan schema, validation, topo-sort, and repair loop are retained; `anthropicProvider.ts`, `planReviewer.ts`, and `repoTools.ts` are deleted.

Conversation state persists as on-disk session state plus the worktree (tracked by new `projects.planner_session_id` / `planner_worktree_path` columns), torn down on approval, project delete, or startup reap. Concurrent planning runs for one project are rejected (per-project lock).

## Consequences — invariants we deliberately dropped

- **Read-only sandbox.** The old planner could not write files or escape the repo root. Claude Code runs with `--dangerously-skip-permissions`; the isolated, discarded worktree is now what contains the blast radius, not a tool-level sandbox.
- **Separate Planner credential.** The Anthropic API key (and its Settings UI) is removed. Planning authenticates via Claude Code's ambient session — the same auth story as the Agent. Planning is now gated on the `claude` binary resolving, and auth failures surface only at run time.
- **Independent reviewer.** The separate critic that judged plans in a fresh context is gone. Plan quality now rests on Claude Code's planning plus the validate/repair loop. (Reconsider an independent reviewer if plan quality regresses.)
- **Harness-agnostic planning.** Execution stays harness-agnostic (Claude Code, Codex, opencode via Harness Profile), but the Planner is fixed to Claude Code so it can rely on Claude Code-specific features (sessions, `stream-json`). A Codex/opencode shop still plans with Claude Code.

This couples the Planner to Claude Code's CLI surface (`--resume`, `stream-json` output schema); a CLI change can break plan parsing.
