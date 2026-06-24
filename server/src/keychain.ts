import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const SERVICE = "arbor";

// Secret storage is platform-specific. On macOS we use the login Keychain via the
// `security` CLI. Everywhere else (notably Linux containers — Fly preview apps) that
// binary doesn't exist, so we fall back to a 0600 JSON file under ARBOR_HOME. The
// public API below is identical on both so callers never branch on platform.
//
// Resolved lazily (not at module load) so tests and tooling can point ARBOR_HOME or
// force a backend via env without re-importing the module. Set
// ARBOR_SECRETS_BACKEND=file to use the file store regardless of platform.
function useFileBackend(): boolean {
  return process.env.ARBOR_SECRETS_BACKEND === "file" || platform() !== "darwin";
}

function secretsFile(): string {
  const home = process.env.ARBOR_HOME ?? join(homedir(), ".arbor");
  return join(home, "secrets.json");
}

// --- macOS Keychain backend ---------------------------------------------------

function keychain(args: string[]): string {
  return execFileSync("security", args, { encoding: "utf8" });
}

// --- File backend (Linux / other) ---------------------------------------------

function readFileStore(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(secretsFile(), "utf8")) as Record<string, string>;
  } catch {
    // Missing or unreadable file → treat as empty store.
    return {};
  }
}

function writeFileStore(store: Record<string, string>): void {
  const file = secretsFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
  // writeFileSync only applies `mode` when creating the file, so enforce it on
  // every write in case the file already existed with looser permissions.
  chmodSync(file, 0o600);
}

// --- Public API ---------------------------------------------------------------

export function setSecret(account: string, value: string): void {
  if (useFileBackend()) {
    const store = readFileStore();
    store[account] = value;
    writeFileStore(store);
    return;
  }
  try {
    keychain(["delete-generic-password", "-s", SERVICE, "-a", account]);
  } catch {
    // no existing entry — nothing to delete
  }
  keychain(["add-generic-password", "-s", SERVICE, "-a", account, "-w", value, "-U"]);
}

export function getSecret(account: string): string | undefined {
  if (useFileBackend()) {
    return readFileStore()[account];
  }
  try {
    return keychain(["find-generic-password", "-s", SERVICE, "-a", account, "-w"]).trim();
  } catch {
    return undefined;
  }
}

export function deleteSecret(account: string): void {
  if (useFileBackend()) {
    const store = readFileStore();
    delete store[account];
    writeFileStore(store);
    return;
  }
  try {
    keychain(["delete-generic-password", "-s", SERVICE, "-a", account]);
  } catch {
    // already absent
  }
}
