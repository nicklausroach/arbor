import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteSecret, getSecret, setSecret } from "./keychain.js";

// Exercises the file backend (forced via ARBOR_SECRETS_BACKEND) so the suite runs
// identically on macOS dev machines and Linux CI without touching the real Keychain.
describe("keychain file backend", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "arbor-keychain-"));
    process.env.ARBOR_HOME = home;
    process.env.ARBOR_SECRETS_BACKEND = "file";
  });

  afterEach(() => {
    delete process.env.ARBOR_HOME;
    delete process.env.ARBOR_SECRETS_BACKEND;
    rmSync(home, { recursive: true, force: true });
  });

  it("returns undefined for an unknown account", () => {
    expect(getSecret("missing")).toBeUndefined();
  });

  it("round-trips a stored secret", () => {
    setSecret("anthropic-api-key", "sk-test-123");
    expect(getSecret("anthropic-api-key")).toBe("sk-test-123");
  });

  it("overwrites an existing secret", () => {
    setSecret("github-pat", "old");
    setSecret("github-pat", "new");
    expect(getSecret("github-pat")).toBe("new");
  });

  it("keeps multiple accounts independent", () => {
    setSecret("a", "1");
    setSecret("b", "2");
    deleteSecret("a");
    expect(getSecret("a")).toBeUndefined();
    expect(getSecret("b")).toBe("2");
  });

  it("writes the store file with 0600 permissions", () => {
    setSecret("anthropic-api-key", "sk-test-123");
    const mode = statSync(join(home, "secrets.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
