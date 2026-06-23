import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBrowsePath } from "./browse.js";

describe("resolveBrowsePath", () => {
  it("defaults to home directory for empty string", () => {
    expect(resolveBrowsePath("")).toBe(os.homedir());
  });

  it("defaults to home directory for null or undefined", () => {
    expect(resolveBrowsePath(null)).toBe(os.homedir());
    expect(resolveBrowsePath(undefined)).toBe(os.homedir());
  });

  it("trims whitespace from input", () => {
    const home = os.homedir();
    expect(resolveBrowsePath("  ")).toBe(home);
  });

  it("resolves absolute paths directly", () => {
    const absolute = "/tmp/test";
    const result = resolveBrowsePath(absolute);
    expect(result).toBe("/tmp/test");
  });

  it("resolves tilde to home directory", () => {
    const result = resolveBrowsePath("~");
    expect(result).toBe(os.homedir());
  });

  it("resolves tilde-relative paths to home directory", () => {
    const result = resolveBrowsePath("~/foo/bar");
    expect(result).toBe(path.join(os.homedir(), "foo", "bar"));
  });

  it("resolves relative paths against home directory", () => {
    const result = resolveBrowsePath("foo/bar");
    expect(result).toBe(path.join(os.homedir(), "foo", "bar"));
  });

  it("rejects paths containing null bytes", () => {
    expect(() => resolveBrowsePath("foo\0bar")).toThrow("Path contains invalid characters");
  });
});
