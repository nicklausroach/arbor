import type { TicketWithDeps } from "../projects/store.js";

export interface DependencyRef {
  title: string;
  issueUrl: string | null;
  prUrl: string | null;
}

export function buildAgentPrompt(params: {
  ticket: TicketWithDeps;
  issueUrl: string;
  branch: string;
  baseBranch: string;
  acceptanceCriteria: string[];
  dependencyRefs: DependencyRef[];
}): string {
  const { ticket, issueUrl, branch, baseBranch, acceptanceCriteria, dependencyRefs } = params;

  const lines = [
    `You are implementing one ticket from an Arbor-managed dependency DAG. Work only on this ticket — do not start other tickets.`,
    ``,
    `## Ticket`,
    `Issue: ${issueUrl}`,
    `Title: ${ticket.title}`,
    `Problem: ${ticket.problem}`,
    ``,
    `## Acceptance criteria`,
    ...acceptanceCriteria.map((a) => `- ${a}`),
  ];

  if (ticket.implementation_notes) {
    lines.push("", "## Implementation notes (non-binding — use your judgment)", ticket.implementation_notes);
  }

  if (dependencyRefs.length) {
    lines.push("", "## Upstream dependencies (already merged into the base branch)");
    for (const d of dependencyRefs) {
      lines.push(`- ${d.title}${d.prUrl ? ` (merged via ${d.prUrl})` : ""}`);
    }
  }

  lines.push(
    "",
    "## Branch & scope",
    `You are checked out on branch \`${branch}\`, created from \`${baseBranch}\`. Stay scoped to this ticket — do not touch unrelated files.`,
    "",
    "## Required steps",
    "1. Implement the ticket so every acceptance criterion is genuinely satisfied.",
    "2. Verify your work (run the project's tests/build/lint as applicable).",
    "3. Commit your changes with a clear message.",
    "4. Push the branch and open a pull request against the base branch.",
    "5. The PR body must include: a summary, an acceptance-criteria checklist, the line `Closes #<issue-number>`, and a short verification note describing what you ran to confirm it works.",
    "6. Print the PR URL on its own line at the end of your output, exactly as returned by your git host (e.g. `https://github.com/owner/repo/pull/123`).",
    "",
    "If you cannot complete the ticket, explain why clearly in your final output rather than opening an incomplete PR."
  );

  return lines.join("\n");
}
