import type { DraftTicket, ProjectSummary } from "./types.js";

// Parses the `{ summary, tickets }` plan object the Planner produces — historically a
// propose_graph tool input, now the contents of the plan.json file Claude Code writes.
// The shape is identical, so the parser is shared and source-agnostic.

export type ParsedPlanInput =
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

export function parsePlanInput(input: unknown): ParsedPlanInput {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["plan must be an object"] };

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
