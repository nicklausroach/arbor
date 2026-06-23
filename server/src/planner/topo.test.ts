import { describe, expect, it } from "vitest";
import { topoOrder } from "./topo.js";
import type { DraftTicket } from "./types.js";

function ticket(id: string, dependsOn: string[] = []): DraftTicket {
  return { id, title: id, problem: "p", acceptanceCriteria: ["a"], dependsOn };
}

describe("topoOrder", () => {
  it("orders a linear chain root-first", () => {
    const order = topoOrder([ticket("T3", ["T2"]), ticket("T1"), ticket("T2", ["T1"])]);
    expect(order.map((t) => t.id)).toEqual(["T1", "T2", "T3"]);
  });

  it("puts every ticket after all of its dependencies", () => {
    const tickets = [ticket("T1"), ticket("T2"), ticket("T3", ["T1", "T2"]), ticket("T4", ["T3"])];
    const order = topoOrder(tickets);
    const indexOf = (id: string) => order.findIndex((t) => t.id === id);
    expect(indexOf("T1")).toBeLessThan(indexOf("T3"));
    expect(indexOf("T2")).toBeLessThan(indexOf("T3"));
    expect(indexOf("T3")).toBeLessThan(indexOf("T4"));
    expect(order).toHaveLength(4);
  });
});
