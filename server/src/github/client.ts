import { execFileSync } from "node:child_process";
import { Octokit } from "octokit";
import { getSecret } from "../keychain.js";

export const GITHUB_PAT_ACCOUNT = "github-pat";

export interface GitHubRemote {
  remoteName: string;
  owner: string;
  name: string;
}

const GITHUB_URL_RE =
  /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/;

export function detectGitHubRemotes(localPath: string): GitHubRemote[] {
  const out = execFileSync("git", ["remote", "-v"], { cwd: localPath, encoding: "utf8" });
  const seen = new Map<string, GitHubRemote>();
  for (const line of out.split("\n")) {
    const [remoteName, url] = line.split(/\s+/);
    if (!remoteName || !url) continue;
    const match = GITHUB_URL_RE.exec(url);
    if (!match) continue;
    seen.set(remoteName, { remoteName, owner: match[1], name: match[2] });
  }
  return [...seen.values()];
}

export function isCleanWorkingTree(localPath: string): boolean {
  const out = execFileSync("git", ["status", "--porcelain"], {
    cwd: localPath,
    encoding: "utf8",
  });
  return out.trim().length === 0;
}

export function getDefaultBranch(localPath: string): string {
  try {
    const out = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: localPath,
      encoding: "utf8",
    });
    return out.trim();
  } catch {
    return "main";
  }
}

export function isGitRepo(localPath: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: localPath,
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

export function octokitFromStoredPat(): Octokit | undefined {
  const token = getSecret(GITHUB_PAT_ACCOUNT);
  if (!token) return undefined;
  return new Octokit({ auth: token });
}

export async function verifyPat(token: string): Promise<{ login: string; scopes: string[] }> {
  const octokit = new Octokit({ auth: token });
  const res = await octokit.request("GET /user");
  const scopeHeader = (res.headers["x-oauth-scopes"] as string | undefined) ?? "";
  const scopes = scopeHeader
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { login: res.data.login, scopes };
}

export async function ensureLabel(octokit: Octokit, owner: string, repo: string, label: string): Promise<void> {
  try {
    await octokit.request("GET /repos/{owner}/{repo}/labels/{name}", { owner, repo, name: label });
  } catch {
    await octokit.request("POST /repos/{owner}/{repo}/labels", {
      owner,
      repo,
      name: label,
      color: "6a4f2a",
      description: "Created and managed by Arbor",
    });
  }
}

export async function createMilestone(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string
): Promise<{ number: number; url: string }> {
  const res = await octokit.request("POST /repos/{owner}/{repo}/milestones", { owner, repo, title });
  return { number: res.data.number, url: res.data.html_url };
}

export async function createIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  params: { title: string; body: string; labels: string[]; milestone: number }
): Promise<{ number: number; url: string }> {
  const res = await octokit.request("POST /repos/{owner}/{repo}/issues", { owner, repo, ...params });
  return { number: res.data.number, url: res.data.html_url };
}

export async function findOpenPrForBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<{ number: number; url: string } | undefined> {
  const res = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
    owner,
    repo,
    state: "open",
    head: `${owner}:${branch}`,
  });
  const pr = res.data[0];
  return pr ? { number: pr.number, url: pr.html_url } : undefined;
}

export async function getPrMergeState(
  octokit: Octokit,
  owner: string,
  repo: string,
  number: number
): Promise<{ merged: boolean; state: string }> {
  const res = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner,
    repo,
    pull_number: number,
  });
  return { merged: Boolean(res.data.merged_at), state: res.data.state };
}
