import Anthropic from "@anthropic-ai/sdk";
import type { PlannerEvent } from "./llm.js";
import type { DraftTicket, ProjectSummary } from "./types.js";

const REVIEW_MODEL = "claude-sonnet-4-5";

export interface PlanReview {
  approved: boolean;
  critique: string;
}

const SUBMIT_REVIEW_TOOL: Anthropic.Tool = {
  name: "submit_review",
  description: "Submit your verdict on the proposed plan. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      approved: {
        type: "boolean",
        description:
          "true if the plan is sound and ready to finalize; false if it should be revised before being shown to the user.",
      },
      critique: {
        type: "string",
        description:
          "Specific, actionable critiques and concrete improvements. Required (non-empty) when approved is false; may be empty when approved is true.",
      },
    },
    required: ["approved", "critique"],
  },
};

const REVIEW_SYSTEM = [
  "You are Arbor's plan reviewer. You critique a proposed dependency-aware DAG of tickets before it is finalized, so the final plan is sharper and more correct.",
  "You are reviewing the planner's work — be a constructive but demanding critic. Judge the plan on:",
  "- Coverage: does the graph fully deliver the objective, with no missing work and no out-of-scope tickets?",
  "- Granularity: is each ticket a single, independently implementable unit — neither too coarse nor artificially split?",
  "- Dependencies: are the dependsOn edges correct and complete? Is anything ordered wrong or missing an edge it truly needs?",
  "- Acceptance criteria: are they concrete, testable, and sufficient to know the ticket is done?",
  "- Clarity: are problem statements unambiguous and self-contained for an agent that implements one ticket in isolation?",
  "Only withhold approval for substantive problems that would meaningfully degrade the plan or the resulting code. Do not block on style nits or personal preference.",
  "When approving, you may still offer brief optional suggestions, but set approved=true.",
  "Call submit_review exactly once with your verdict.",
].join("\n");

export function buildReviewUserPrompt(input: {
  objective: string;
  userMessage: string;
  summary: ProjectSummary;
  tickets: DraftTicket[];
}): string {
  return [
    `Objective: ${input.objective}`,
    `Latest user message: ${input.userMessage}`,
    `Proposed plan summary:\n${JSON.stringify(input.summary, null, 2)}`,
    `Proposed tickets:\n${JSON.stringify(input.tickets, null, 2)}`,
    "Review this plan and call submit_review.",
  ].join("\n\n");
}

export function parseReviewInput(input: unknown): PlanReview {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { approved: true, critique: "" };
  }
  const record = input as Record<string, unknown>;
  const approved = record.approved !== false; // default to approve unless explicitly false
  const critique = typeof record.critique === "string" ? record.critique : "";
  // A rejection with no critique is unactionable — treat it as an approval so the planner isn't
  // sent back empty-handed.
  if (!approved && critique.trim() === "") return { approved: true, critique: "" };
  return { approved, critique };
}

export interface ReviewPlanArgs {
  client: Anthropic;
  objective: string;
  userMessage: string;
  summary: ProjectSummary;
  tickets: DraftTicket[];
  onEvent?: (event: PlannerEvent) => void;
}

/**
 * Single-shot subagent that critiques a structurally-valid proposed plan before it is
 * finalized. Returns the verdict; the caller decides whether to send the critique back to
 * the planner for revision.
 */
export async function reviewPlan(args: ReviewPlanArgs): Promise<PlanReview> {
  const { client, onEvent = () => {} } = args;

  const response = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 2048,
    system: REVIEW_SYSTEM,
    tools: [SUBMIT_REVIEW_TOOL],
    tool_choice: { type: "tool", name: "submit_review" },
    messages: [{ role: "user", content: buildReviewUserPrompt(args) }],
  });

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_review"
  );
  const review = block ? parseReviewInput(block.input) : { approved: true, critique: "" };

  onEvent({
    type: "tool_call",
    tag: "review_plan",
    text: review.approved
      ? review.critique.trim()
        ? `approved with notes: ${review.critique}`
        : "approved"
      : `revision requested: ${review.critique}`,
  });

  return review;
}
