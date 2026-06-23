import { execFileSync } from "node:child_process";

const SERVICE = "arbor";

function run(args: string[]): string {
  return execFileSync("security", args, { encoding: "utf8" });
}

export function setSecret(account: string, value: string): void {
  try {
    run(["delete-generic-password", "-s", SERVICE, "-a", account]);
  } catch {
    // no existing entry — nothing to delete
  }
  run(["add-generic-password", "-s", SERVICE, "-a", account, "-w", value, "-U"]);
}

export function getSecret(account: string): string | undefined {
  try {
    return run(["find-generic-password", "-s", SERVICE, "-a", account, "-w"]).trim();
  } catch {
    return undefined;
  }
}

export function deleteSecret(account: string): void {
  try {
    run(["delete-generic-password", "-s", SERVICE, "-a", account]);
  } catch {
    // already absent
  }
}
