import type { DraftTicket } from "./types.js";

export type ValidationResult =
  | { ok: true; tickets: DraftTicket[] }
  | { ok: false; errors: string[] };

export function validateGraph(tickets: DraftTicket[]): ValidationResult {
  const errors: string[] = [];

  const ids = new Set<string>();
  for (const t of tickets) {
    if (ids.has(t.id)) errors.push(`Duplicate ticket id: ${t.id}`);
    ids.add(t.id);
  }

  for (const t of tickets) {
    for (const dep of t.dependsOn) {
      if (dep === t.id) errors.push(`Ticket ${t.id} depends on itself`);
      else if (!ids.has(dep)) errors.push(`Ticket ${t.id} depends on missing ticket ${dep}`);
    }
  }
  if (errors.length) return { ok: false, errors };

  // Cycle detection via DFS coloring.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(tickets.map((t) => [t.id, WHITE]));
  const byId = new Map(tickets.map((t) => [t.id, t]));

  const visit = (id: string, stack: string[]): void => {
    color.set(id, GRAY);
    const t = byId.get(id);
    for (const dep of t?.dependsOn ?? []) {
      const depColor = color.get(dep);
      if (depColor === GRAY) {
        errors.push(`Cycle detected: ${[...stack, id, dep].join(" -> ")}`);
      } else if (depColor === WHITE) {
        visit(dep, [...stack, id]);
      }
    }
    color.set(id, BLACK);
  };
  for (const t of tickets) {
    if (color.get(t.id) === WHITE) visit(t.id, []);
  }
  if (errors.length) return { ok: false, errors };

  // Orphan check: the whole graph must form one weakly-connected component — every
  // ticket must relate (directly or transitively) to every other via dependency
  // edges, ignoring direction. A ticket with no edges at all to the rest of the
  // graph belongs to a different objective and doesn't belong in this plan.
  if (tickets.length > 1) {
    const undirected = new Map<string, Set<string>>(tickets.map((t) => [t.id, new Set<string>()]));
    for (const t of tickets) {
      for (const dep of t.dependsOn) {
        undirected.get(t.id)!.add(dep);
        undirected.get(dep)!.add(t.id);
      }
    }
    const visited = new Set<string>();
    const queue = [tickets[0].id];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(...(undirected.get(id) ?? []));
    }
    for (const t of tickets) {
      if (!visited.has(t.id)) errors.push(`Ticket ${t.id} is orphaned (disconnected from the rest of the plan)`);
    }
  }
  if (errors.length) return { ok: false, errors };

  return { ok: true, tickets };
}
