import type { DraftTicket } from "./types.js";

// Assumes the graph is already validated (acyclic, resolvable). Roots come first so that,
// when issues are created in this order, a ticket's dependencies already have issue numbers.
export function topoOrder(tickets: DraftTicket[]): DraftTicket[] {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const remaining = new Map(tickets.map((t) => [t.id, new Set(t.dependsOn)]));
  const ordered: DraftTicket[] = [];
  const ready = tickets.filter((t) => t.dependsOn.length === 0).map((t) => t.id);

  while (ready.length) {
    const id = ready.shift()!;
    const t = byId.get(id)!;
    ordered.push(t);
    for (const other of tickets) {
      const deps = remaining.get(other.id)!;
      if (deps.delete(id) && deps.size === 0 && !ordered.includes(other) && !ready.includes(other.id)) {
        ready.push(other.id);
      }
    }
  }
  return ordered;
}
