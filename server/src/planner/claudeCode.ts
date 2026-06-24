import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClaudeBin } from "../runner/claudeBin.js";
import { planFileRelPath } from "../runner/paths.js";
import { ensurePlannerWorktree } from "./plannerSession.js";
import { MalformedPlannerOutputError, parsePlanInput } from "./planParse.js";
import type { PlannerEvent, PlannerInput, PlannerProvider } from "./llm.js";
import type { DraftTicket, PlannerResult, ProjectSummary } from "./types.js";

// Tool calls we don't surface to the planning chat — pure bookkeeping/noise.
const HIDDEN_TOOLS = new Set(["TodoWrite"]);

function condenseToolInput(name: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  const value =
    pick("file_path") ?? pick("path") ?? pick("pattern") ?? pick("command") ?? pick("description") ?? pick("prompt");
  if (value !== undefined) return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}

function buildPlannerPrompt(input: PlannerInput, planRelPath: string): string {
  const parts: string[] = [
    "You are Arbor's planning assistant. Turn the objective below into a small, valid, dependency-aware DAG of tickets that downstream coding agents will implement one at a time.",
    "You are running inside a git worktree of the target repository. Research the repo with your read tools to ground the plan in the real codebase, but stay scoped — do not read every file. Do NOT modify source code, run builds, commit, or open pull requests. Your only write is the plan file described below.",
    "Each ticket needs: a stable short id (e.g. T1, T2), a title, a problem statement, 2-5 concrete acceptance criteria, optional non-binding implementation notes, and dependsOn (ids of tickets that must merge first). The graph must be acyclic, every dependsOn id must reference a real ticket in your output, and every ticket must be connected (directly or transitively) to the rest of the plan. Prefer the smallest graph that honestly captures the work — 3-8 tickets for a typical objective.",
    `When ready, write your final plan as raw JSON (no markdown fences) to this exact path, relative to your working directory: ${planRelPath}`,
    'The file must match this schema exactly: {"summary":{"title":string,"objective":string},"tickets":[{"id":string,"title":string,"problem":string,"acceptanceCriteria":string[],"implementationNotes"?:string,"dependsOn":string[]}]}',
    "Create parent directories as needed. After writing the file, briefly summarize the plan in your final message.",
    "",
    `Objective: ${input.objective}`,
  ];
  if (input.pinnedPaths.length) parts.push(`Pinned paths to consider: ${input.pinnedPaths.join(", ")}`);
  if (input.previousTickets) {
    parts.push(`Previous valid graph:\n${JSON.stringify(input.previousTickets, null, 2)}`);
  }
  if (input.repairErrors?.length) {
    parts.push(
      `Your last plan file was INVALID. Repair it against the previous valid graph above and write the corrected file. Errors:\n${input.repairErrors.join("\n")}`
    );
  }
  parts.push(`User message: ${input.userMessage}`);
  return parts.join("\n\n");
}

interface ClaudeRunOutput {
  exitCode: number | null;
  assistantMessage: string;
  toolCalls: { tag: string; text: string }[];
}

// Spawns one Claude Code run, streaming stream-json output into PlannerEvents. The prompt
// is piped via stdin; session args either start a new session (--session-id) or resume one.
function runClaude(
  worktreeDir: string,
  prompt: string,
  sessionArgs: string[],
  onEvent: (event: PlannerEvent) => void
): Promise<ClaudeRunOutput> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      ...sessionArgs,
    ];
    const child = spawn(resolveClaudeBin(), args, { cwd: worktreeDir, stdio: ["pipe", "pipe", "pipe"] });

    const toolCalls: { tag: string; text: string }[] = [];
    const textChunks: string[] = [];
    let buffer = "";

    const handleEvent = (obj: Record<string, unknown>): void => {
      if (obj.type !== "assistant") return;
      const message = obj.message as { content?: unknown[] } | undefined;
      for (const block of message?.content ?? []) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          textChunks.push(b.text);
          onEvent({ type: "text", text: b.text });
        } else if (b.type === "tool_use" && typeof b.name === "string" && !HIDDEN_TOOLS.has(b.name)) {
          const text = condenseToolInput(b.name, (b.input ?? {}) as Record<string, unknown>);
          toolCalls.push({ tag: b.name, text });
          onEvent({ type: "tool_call", tag: b.name, text });
        }
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line) as Record<string, unknown>);
        } catch {
          // a non-JSON line (rare) — ignore rather than crash the stream
        }
      }
    });
    // stderr is captured only for diagnostics; stream-json carries the real output.
    child.stderr.on("data", () => {});

    child.on("error", (err) => reject(err));
    child.on("close", (exitCode) => {
      resolve({ exitCode, assistantMessage: textChunks.join("\n"), toolCalls });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function readPlanFile(worktreeDir: string, planRelPath: string): { summary: ProjectSummary; tickets: DraftTicket[] } {
  const abs = join(worktreeDir, planRelPath);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    throw new MalformedPlannerOutputError([`plan file was not written at ${planRelPath}`]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MalformedPlannerOutputError([`plan file at ${planRelPath} is not valid JSON`]);
  }
  const result = parsePlanInput(parsed);
  if (!result.ok) throw new MalformedPlannerOutputError(result.errors);
  return { summary: result.summary, tickets: result.tickets };
}

export class ClaudeCodePlannerProvider implements PlannerProvider {
  async draftGraph(input: PlannerInput): Promise<PlannerResult> {
    const worktreeDir = ensurePlannerWorktree(input.repoPath, input.projectId, input.baseBranch);
    const planRelPath = planFileRelPath(input.projectId, input.versionNumber);
    const prompt = buildPlannerPrompt(input, planRelPath);
    const onEvent = input.onEvent ?? (() => {});

    // Resume the project's session if we have one; otherwise mint a new id. If a resume
    // run fails outright (e.g. the session is gone after a host change), fall back to a
    // fresh session once — the prompt already carries previousTickets to re-seed it.
    let sessionId = input.sessionId ?? randomUUID();
    let resuming = Boolean(input.sessionId);
    let run = await runClaude(worktreeDir, prompt, sessionArgs(resuming, sessionId), onEvent);

    if (run.exitCode !== 0 && resuming) {
      sessionId = randomUUID();
      resuming = false;
      run = await runClaude(worktreeDir, prompt, sessionArgs(resuming, sessionId), onEvent);
    }

    if (run.exitCode !== 0) {
      throw new Error(`Claude Code planner exited with code ${run.exitCode}`);
    }

    const { summary, tickets } = readPlanFile(worktreeDir, planRelPath);
    return { summary, tickets, assistantMessage: run.assistantMessage, toolCalls: run.toolCalls, sessionId };
  }
}

function sessionArgs(resuming: boolean, sessionId: string): string[] {
  return resuming ? ["--resume", sessionId] : ["--session-id", sessionId];
}
