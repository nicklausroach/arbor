import Anthropic from "@anthropic-ai/sdk";
import { grep, listDir, readFile, repoTree } from "./repoTools.js";
import type { PlannerInput, PlannerProvider } from "./llm.js";
import type { DraftTicket, PlannerResult, ProjectSummary } from "./types.js";

const MODEL = "claude-sonnet-4-5";
const MAX_TURNS = 14;
const NUDGE_AFTER_TURN = 4;

const PROPOSE_GRAPH_TOOL: Anthropic.Tool = {
  name: "propose_graph",
  description:
    "Submit the final drafted project summary and ticket dependency DAG. Call this exactly once, when you are done researching and are ready to present a plan (or a repair of an invalid one).",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short project title" },
          objective: { type: "string", description: "One paragraph restating the objective" },
        },
        required: ["title", "objective"],
      },
      tickets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Stable short id, e.g. T1, T2" },
            title: { type: "string" },
            problem: { type: "string" },
            acceptanceCriteria: { type: "array", items: { type: "string" } },
            implementationNotes: { type: "string" },
            dependsOn: { type: "array", items: { type: "string" } },
          },
          required: ["id", "title", "problem", "acceptanceCriteria", "dependsOn"],
        },
      },
    },
    required: ["summary", "tickets"],
  },
};

const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_dir",
    description: "List files and subdirectories at a path relative to the repo root.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: 'Relative path, "" for root' } },
      required: ["path"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file's contents, relative to the repo root.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "grep",
    description: "Search tracked files in the repo for a regex pattern (git grep).",
    input_schema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
  {
    name: "repo_tree",
    description: "List all git-tracked file paths in the repo (truncated if very large).",
    input_schema: { type: "object", properties: {} },
  },
];

type ParsedProposeGraphInput =
  | { ok: true; summary: ProjectSummary; tickets: DraftTicket[] }
  | { ok: false; errors: string[] };

export class MalformedPlannerOutputError extends Error {
  constructor(readonly errors: string[]) {
    super(`Planner produced malformed graph: ${errors.join("; ")}`);
    this.name = "MalformedPlannerOutputError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown, field: string, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return undefined;
  }
  const nonStringIndex = value.findIndex((item) => typeof item !== "string");
  if (nonStringIndex !== -1) {
    errors.push(`${field}[${nonStringIndex}] must be a string`);
    return undefined;
  }
  return value;
}

export function parseProposeGraphInput(input: unknown): ParsedProposeGraphInput {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["propose_graph input must be an object"] };

  const summaryInput = input.summary;
  let summary: ProjectSummary | undefined;
  if (!isRecord(summaryInput)) {
    errors.push("summary must be an object");
  } else {
    const { title, objective } = summaryInput;
    if (typeof title !== "string") errors.push("summary.title must be a string");
    if (typeof objective !== "string") errors.push("summary.objective must be a string");
    if (typeof title === "string" && typeof objective === "string") summary = { title, objective };
  }

  if (!Array.isArray(input.tickets)) {
    errors.push("tickets must be an array");
    return { ok: false, errors };
  }

  const tickets: DraftTicket[] = [];
  input.tickets.forEach((ticketInput, index) => {
    if (!isRecord(ticketInput)) {
      errors.push(`tickets[${index}] must be an object`);
      return;
    }

    const { id, title, problem, implementationNotes } = ticketInput;
    if (typeof id !== "string") errors.push(`tickets[${index}].id must be a string`);
    if (typeof title !== "string") errors.push(`tickets[${index}].title must be a string`);
    if (typeof problem !== "string") errors.push(`tickets[${index}].problem must be a string`);
    if (implementationNotes !== undefined && typeof implementationNotes !== "string") {
      errors.push(`tickets[${index}].implementationNotes must be a string`);
    }

    const acceptanceCriteria = stringArray(ticketInput.acceptanceCriteria, `tickets[${index}].acceptanceCriteria`, errors) ?? [];
    const dependsOn = stringArray(ticketInput.dependsOn, `tickets[${index}].dependsOn`, errors) ?? [];

    if (typeof id === "string" && typeof title === "string" && typeof problem === "string") {
      tickets.push({
        id,
        title,
        problem,
        acceptanceCriteria,
        ...(typeof implementationNotes === "string" ? { implementationNotes } : {}),
        dependsOn,
      });
    }
  });

  if (errors.length || !summary) return { ok: false, errors };
  return { ok: true, summary, tickets };
}

function runTool(repoPath: string, name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "list_dir":
      return listDir(repoPath, String(input.path ?? "")).join("\n") || "(empty)";
    case "read_file":
      return readFile(repoPath, String(input.path ?? ""));
    case "grep":
      return grep(repoPath, String(input.pattern ?? ""));
    case "repo_tree":
      return repoTree(repoPath);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export class AnthropicPlannerProvider implements PlannerProvider {
  constructor(private readonly apiKey: string) {}

  async draftGraph(input: PlannerInput): Promise<PlannerResult> {
    const client = new Anthropic({ apiKey: this.apiKey });

    const system = [
      "You are Arbor's planning assistant. You turn a repo-scoped objective into a small, valid, dependency-aware DAG of tickets that downstream coding agents will implement one at a time.",
      "Use the read-only tools to inspect the repo before drafting — read enough to ground the plan in the real codebase, but stay scoped (don't read every file).",
      "Each ticket needs: a stable short id, a title, a problem statement, 2-5 concrete acceptance criteria, optional non-binding implementation notes, and dependsOn (ids of tickets that must merge first).",
      "The graph must be acyclic, every dependsOn id must reference a real ticket in your output, and every ticket must be connected (directly or transitively) to the rest of the plan — no disconnected side-quests.",
      "Prefer the smallest graph that honestly captures the work — 3-8 tickets for a typical objective.",
      "Match research effort to the objective: a small, well-scoped objective (e.g. adding one doc file) needs only 1-3 tool calls — a skim of the repo root and maybe one related file. Do not grep for speculative keywords or read files unrelated to the objective. Bias toward proposing sooner rather than later.",
      "When ready, call propose_graph exactly once with your final answer.",
    ].join("\n");

    const userParts: string[] = [`Objective: ${input.objective}`];
    if (input.pinnedPaths.length) userParts.push(`Pinned paths to consider: ${input.pinnedPaths.join(", ")}`);
    if (input.previousTickets) {
      userParts.push(`Previous valid graph:\n${JSON.stringify(input.previousTickets, null, 2)}`);
    }
    if (input.repairErrors?.length) {
      userParts.push(
        `Your last proposal was INVALID. Repair it against the previous valid graph above. Errors:\n${input.repairErrors.join("\n")}`
      );
    }
    userParts.push(`User message: ${input.userMessage}`);

    const messages: Anthropic.MessageParam[] = [
      ...input.history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam),
      { role: "user", content: userParts.join("\n\n") },
    ];

    const toolCalls: { tag: string; text: string }[] = [];
    let assistantMessage = "";
    const onEvent = input.onEvent ?? (() => {});

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 4096,
        system,
        tools: [...READ_TOOLS, PROPOSE_GRAPH_TOOL],
        messages,
      });
      stream.on("text", (delta) => onEvent({ type: "text_delta", text: delta }));
      stream.on("contentBlock", (block) => {
        if (block.type === "text" && block.text.trim()) onEvent({ type: "text", text: block.text });
      });
      const response = await stream.finalMessage();

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      if (textBlocks.length) assistantMessage = textBlocks.map((b) => b.text).join("\n");

      const proposeBlock = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "propose_graph"
      );
      if (proposeBlock) {
        const parsed = parseProposeGraphInput(proposeBlock.input);
        if (!parsed.ok) throw new MalformedPlannerOutputError(parsed.errors);
        return {
          summary: parsed.summary,
          tickets: parsed.tickets,
          assistantMessage,
          toolCalls,
        } satisfies PlannerResult;
      }

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUseBlocks.length === 0) {
        // Model stopped without proposing a graph — surface what it said as an error.
        throw new Error(`Planner did not propose a graph: ${assistantMessage || "(no text)"}`);
      }

      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        onEvent({ type: "tool_call", tag: block.name, text: JSON.stringify(block.input) });
        let result: string;
        try {
          result = runTool(input.repoPath, block.name, block.input as Record<string, unknown>);
        } catch (err) {
          result = `Error: ${(err as Error).message}`;
        }
        toolCalls.push({ tag: block.name, text: JSON.stringify(block.input) });
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
      const content: Anthropic.MessageParam["content"] =
        turn >= NUDGE_AFTER_TURN
          ? [
              ...toolResults,
              {
                type: "text",
                text: `You've made ${turn + 1} research turns. Stop exploring and call propose_graph now with your best plan based on what you've already learned.`,
              },
            ]
          : toolResults;
      messages.push({ role: "user", content });
    }

    throw new Error("Planner exceeded max tool-use turns without proposing a graph");
  }
}
