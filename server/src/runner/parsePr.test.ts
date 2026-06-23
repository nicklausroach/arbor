import { describe, expect, it } from "vitest";
import { parsePrUrl } from "./parsePr.js";

describe("parsePrUrl", () => {
  it("extracts a matching PR URL", () => {
    const out = "Pushed branch.\nOpened PR: https://github.com/acme/widgets/pull/42\nDone.";
    expect(parsePrUrl(out, "acme", "widgets")).toEqual({ number: 42, url: "https://github.com/acme/widgets/pull/42" });
  });

  it("ignores PR URLs for a different repo", () => {
    const out = "https://github.com/someone-else/other/pull/9";
    expect(parsePrUrl(out, "acme", "widgets")).toBeUndefined();
  });

  it("returns the last match when several PR URLs are mentioned", () => {
    const out = "https://github.com/acme/widgets/pull/1 then later https://github.com/acme/widgets/pull/2";
    expect(parsePrUrl(out, "acme", "widgets")?.number).toBe(2);
  });

  it("returns undefined when there is no PR URL", () => {
    expect(parsePrUrl("no links here", "acme", "widgets")).toBeUndefined();
  });
});
