import { describe, expect, it } from "vitest";
import { parseProposeGraphInput } from "./anthropicProvider.js";

describe("parseProposeGraphInput", () => {
  it("rejects a non-array tickets payload without throwing", () => {
    const result = parseProposeGraphInput({
      summary: { title: "Plan", objective: "Do the work" },
      tickets: { id: "T1" },
    });

    expect(result).toEqual({ ok: false, errors: ["tickets must be an array"] });
  });

  it("normalizes optional ticket arrays", () => {
    const result = parseProposeGraphInput({
      summary: { title: "Plan", objective: "Do the work" },
      tickets: [{ id: "T1", title: "First", problem: "Problem" }],
    });

    expect(result).toEqual({
      ok: true,
      summary: { title: "Plan", objective: "Do the work" },
      tickets: [{ id: "T1", title: "First", problem: "Problem", acceptanceCriteria: [], dependsOn: [] }],
    });
  });
});
