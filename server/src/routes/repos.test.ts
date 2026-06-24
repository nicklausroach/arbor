import { describe, expect, it } from "vitest";
import { pickRepositoryPath } from "./repos.js";

describe("pickRepositoryPath", () => {
  it("returns the absolute folder path selected by the native macOS picker", async () => {
    const fakeExecFile = (
      _file: string,
      _args: string[],
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      callback(null, "/Users/alex/code/arbor\n", "");
    };

    await expect(pickRepositoryPath("darwin", fakeExecFile)).resolves.toBe("/Users/alex/code/arbor");
  });
});
