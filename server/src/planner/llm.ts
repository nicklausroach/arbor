import type { DraftTicket, PlannerResult } from "./types.js";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PlannerInput {
  repoPath: string;
  objective: string;
  pinnedPaths: string[];
  history: ChatTurn[];
  userMessage: string;
  previousTickets: DraftTicket[] | undefined;
  repairErrors: string[] | undefined;
}

export interface PlannerProvider {
  draftGraph(input: PlannerInput): Promise<PlannerResult>;
}
