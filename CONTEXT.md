# Arbor

Arbor turns high-level objectives into dependency-aware task graphs and coordinates agent-based execution against a git repository, with full traceability from objective to merged PR.

## Language

**Ticket**:
One node in the dependency DAG — a granular unit of work with a problem statement, acceptance criteria, and upstream dependencies. An agent implements exactly one ticket per run.
_Avoid_: Task, issue (issue refers specifically to the GitHub issue mirroring a ticket).

**Run**:
A single execution attempt of a ticket by an agent. Produces a log and, on success, a pull request. A ticket may have multiple runs across retries.

**Agent**:
The coding-assistant process that implements a ticket — reads the prompt, edits code in a worktree, and opens a PR. The concrete CLI invoked is determined by a Harness. The Agent authenticates with its own provider using credentials the user configured *outside* Arbor (ambient env vars or the harness's own OAuth session); Arbor does not manage Agent authentication.
_Avoid_: Bot, worker.

**Planner**:
The Claude Code-driven step that turns a repo-scoped objective into a validated DAG of tickets. Runs as its own Claude Code session against the repository, distinct from the Agent that implements tickets — the Planner produces the plan, not production code. Authenticates via Claude Code's own session, not a credential Arbor manages. Unlike the Agent, the Planner is fixed to Claude Code rather than the configurable Harness.
_Avoid_: Generator.

**Harness**:
A coding-agent CLI that Arbor can drive to implement tickets (e.g. Claude Code, Codex, opencode). Arbor is harness-agnostic: any CLI that accepts a prompt and produces a PR can be plugged in.
_Avoid_: Tool, backend, model.

**Harness Profile**:
The configuration describing *how* to invoke a particular Harness: a run command (optionally containing a `{prompt}` or `{promptFile}` placeholder; prompt is piped to stdin if neither is present) and an optional session-resume command. It carries no credentials or env/secret management — Agent authentication is the user's responsibility, configured outside Arbor.
_Avoid_: Agent command (the old single-string setting this replaces).

**Preset**:
A built-in Harness Profile that ships with Arbor for a known harness (Claude Code, Codex, opencode). Selectable in one click; a "Custom" profile covers anything else.
