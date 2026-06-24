import { describe, expect, it } from "vitest";
import { parsePlanInput } from "./planParse.js";

describe("parsePlanInput", () => {
  it("rejects a non-array tickets payload without throwing", () => {
    const result = parsePlanInput({
      summary: { title: "Plan", objective: "Do the work" },
      tickets: { id: "T1" },
    });

    expect(result).toEqual({ ok: false, errors: ["tickets must be an array"] });
  });

  it("normalizes optional ticket arrays", () => {
    const result = parsePlanInput({
      summary: { title: "Plan", objective: "Do the work" },
      tickets: [{ id: "T1", title: "First", problem: "Problem" }],
    });

    expect(result).toEqual({
      ok: true,
      summary: { title: "Plan", objective: "Do the work" },
      tickets: [{ id: "T1", title: "First", problem: "Problem", acceptanceCriteria: [], dependsOn: [] }],
    });
  });

  it("rejects a non-object plan", () => {
    expect(parsePlanInput("nope")).toEqual({ ok: false, errors: ["plan must be an object"] });
  });
});
