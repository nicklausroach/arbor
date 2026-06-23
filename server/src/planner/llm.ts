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
  repoPath: string;
  objective: string;
  pinnedPaths: string[];
  history: ChatTurn[];
  userMessage: string;
  previousTickets: DraftTicket[] | undefined;
  repairErrors: string[] | undefined;
  onEvent?: (event: PlannerEvent) => void;
}

export interface PlannerProvider {
  draftGraph(input: PlannerInput): Promise<PlannerResult>;
}
