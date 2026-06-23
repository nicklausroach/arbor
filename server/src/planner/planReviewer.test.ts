import { describe, expect, it } from "vitest";
import { buildReviewUserPrompt, parseReviewInput } from "./planReviewer.js";

describe("parseReviewInput", () => {
  it("passes through an explicit rejection with a critique", () => {
    expect(parseReviewInput({ approved: false, critique: "Split T2 into two tickets" })).toEqual({
      approved: false,
      critique: "Split T2 into two tickets",
    });
  });

  it("treats a rejection with an empty critique as approval", () => {
    expect(parseReviewInput({ approved: false, critique: "   " })).toEqual({ approved: true, critique: "" });
  });

  it("keeps optional notes on an approval", () => {
    expect(parseReviewInput({ approved: true, critique: "Consider naming T1 more concretely" })).toEqual({
      approved: true,
      critique: "Consider naming T1 more concretely",
    });
  });

  it("defaults to approval for malformed input", () => {
    expect(parseReviewInput(null)).toEqual({ approved: true, critique: "" });
    expect(parseReviewInput({ critique: "no verdict" })).toEqual({ approved: true, critique: "no verdict" });
  });
});

describe("buildReviewUserPrompt", () => {
  it("includes the objective, user message, and serialized plan", () => {
    const prompt = buildReviewUserPrompt({
      objective: "Add logging",
      userMessage: "go",
      summary: { title: "Logging", objective: "Add logging" },
      tickets: [{ id: "T1", title: "Add logger", problem: "No logs", acceptanceCriteria: [], dependsOn: [] }],
    });

    expect(prompt).toContain("Objective: Add logging");
    expect(prompt).toContain("Latest user message: go");
    expect(prompt).toContain('"id": "T1"');
    expect(prompt).toContain("submit_review");
  });
});
