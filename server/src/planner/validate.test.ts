import { describe, expect, it } from "vitest";
import { validateGraph } from "./validate.js";
import type { DraftTicket } from "./types.js";

function ticket(id: string, dependsOn: string[] = []): DraftTicket {
  return { id, title: id, problem: "p", acceptanceCriteria: ["a"], dependsOn };
}

describe("validateGraph", () => {
  it("accepts a valid linear chain", () => {
    const result = validateGraph([ticket("T1"), ticket("T2", ["T1"]), ticket("T3", ["T2"])]);
    expect(result.ok).toBe(true);
  });

  it("rejects a missing dependency reference", () => {
    const result = validateGraph([ticket("T1", ["T0"])]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/missing ticket T0/);
  });

  it("rejects a cycle", () => {
    const result = validateGraph([ticket("T1", ["T2"]), ticket("T2", ["T1"])]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/Cycle detected/);
  });

  it("rejects a ticket disconnected from the rest of the plan", () => {
    const result = validateGraph([ticket("T1"), ticket("T2", ["T1"]), ticket("T3")]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/T3 is orphaned/);
  });

  it("accepts multiple roots that converge into a shared downstream ticket", () => {
    const result = validateGraph([ticket("T1"), ticket("T2"), ticket("T3", ["T1", "T2"])]);
    expect(result.ok).toBe(true);
  });

  it("rejects a self-dependency", () => {
    const result = validateGraph([ticket("T1", ["T1"])]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/depends on itself/);
  });

  it("rejects a graph where every ticket has a dependency (no root)", () => {
    // Only reachable via cycle detection in practice, but guard explicitly too.
    const result = validateGraph([ticket("T1", ["T2"]), ticket("T2", ["T3"]), ticket("T3", ["T1"])]);
    expect(result.ok).toBe(false);
  });
});
