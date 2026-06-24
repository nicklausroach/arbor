import type { DraftTicket, PlannerResult } from "./types.js";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type PlannerEvent =
  | { type: "text_delta"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; tag: string; text: string };

export interface PlannerInput {
  projectId: string;
  /** The repository's local clone — the worktree is created from here. */
  repoPath: string;
  /** Branch the planning worktree is cut from (the repo default branch). */
  baseBranch: string;
  objective: string;
  pinnedPaths: string[];
  history: ChatTurn[];
  userMessage: string;
  previousTickets: DraftTicket[] | undefined;
  repairErrors: string[] | undefined;
  /** Version number the produced plan will become; namespaces the plan.json path. */
  versionNumber: number;
  /** Existing planning session to resume, or undefined to start a new one. */
  sessionId: string | undefined;
  onEvent?: (event: PlannerEvent) => void;
}

export interface PlannerProvider {
  draftGraph(input: PlannerInput): Promise<PlannerResult>;
}
