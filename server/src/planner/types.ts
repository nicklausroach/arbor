export interface DraftTicket {
  id: string;
  title: string;
  problem: string;
  acceptanceCriteria: string[];
  implementationNotes?: string;
  dependsOn: string[];
}

export interface ProjectSummary {
  title: string;
  objective: string;
}

export interface PlannerResult {
  summary: ProjectSummary;
  tickets: DraftTicket[];
  assistantMessage: string;
  toolCalls: { tag: string; text: string }[];
}
