import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { App, Octokit } from "octokit";
import { getSecret } from "../keychain.js";

export const GITHUB_PAT_ACCOUNT = "github-pat";

export const GITHUB_OAUTH_CLIENT_ID_ENV = "ARBOR_GITHUB_CLIENT_ID";
export const GITHUB_OAUTH_SCOPES_ENV = "ARBOR_GITHUB_OAUTH_SCOPES";
export const GITHUB_APP_ID_ENV = "ARBOR_GITHUB_APP_ID";
export const GITHUB_APP_PRIVATE_KEY_ENV = "ARBOR_GITHUB_APP_PRIVATE_KEY";
export const GITHUB_APP_PRIVATE_KEY_PATH_ENV = "ARBOR_GITHUB_APP_PRIVATE_KEY_PATH";

interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface GitHubAccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface GitHubDeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

export function githubOAuthClientId(): string | undefined {
  return process.env[GITHUB_OAUTH_CLIENT_ID_ENV] || undefined;
}

function assertGitHubOAuthClientId(): string {
  const clientId = githubOAuthClientId();
  if (!clientId) {
    throw new Error(`${GITHUB_OAUTH_CLIENT_ID_ENV} is required to use GitHub login.`);
  }
  return clientId;
}

function githubOAuthScopes(): string {
  return process.env[GITHUB_OAUTH_SCOPES_ENV] ?? "repo";
}

export interface GitHubRepositoryAuth {
  github_installation_id?: number | null;
}

function githubAppId(): string | undefined {
  return process.env[GITHUB_APP_ID_ENV] || undefined;
}

function resolvePrivateKeyPath(keyPath: string): string {
  if (isAbsolute(keyPath)) return keyPath;
  const candidates = [join(process.cwd(), keyPath), join(process.cwd(), "..", keyPath)];
  return candidates.find((candidate) => existsSync(candidate)) ?? keyPath;
}

function githubAppPrivateKey(): string | undefined {
  const inlineKey = process.env[GITHUB_APP_PRIVATE_KEY_ENV];
  if (inlineKey) return inlineKey.replace(/\\n/g, "\n");
  const keyPath = process.env[GITHUB_APP_PRIVATE_KEY_PATH_ENV];
  if (keyPath) return readFileSync(resolvePrivateKeyPath(keyPath), "utf8");
  return undefined;
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(githubAppId() && githubAppPrivateKey());
}

function githubApp(): App {
  const appId = githubAppId();
  const privateKey = githubAppPrivateKey();
  if (!appId || !privateKey) {
    throw new Error(`${GITHUB_APP_ID_ENV} and either ${GITHUB_APP_PRIVATE_KEY_ENV} or ${GITHUB_APP_PRIVATE_KEY_PATH_ENV} are required to use GitHub App auth.`);
  }
  return new App({ appId, privateKey });
}

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

export async function octokitForRepository(repo: GitHubRepositoryAuth): Promise<Octokit | undefined> {
  if (repo.github_installation_id) {
    return githubApp().getInstallationOctokit(repo.github_installation_id);
  }
  return octokitFromStoredPat();
}

export async function findGitHubAppInstallationForOwner(owner: string): Promise<{ id: number; accountId?: number } | undefined> {
  const app = githubApp();
  const installations = await app.octokit.paginate("GET /app/installations", { per_page: 100 });
  const match = installations.find((installation) => installation.account?.login?.toLowerCase() === owner.toLowerCase());
  return match ? { id: match.id, accountId: match.account?.id } : undefined;
}

export async function getGitHubAppInstallationUrl(state: string, targetId?: number): Promise<string> {
  return githubApp().getInstallationUrl({ state, target_id: targetId });
}

export async function verifyGitHubAppInstallationRepo(
  installationId: number,
  owner: string,
  repo: string
): Promise<void> {
  const octokit = await githubApp().getInstallationOctokit(installationId);
  await octokit.request("GET /repos/{owner}/{repo}", { owner, repo });
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

export async function startGitHubDeviceLogin(): Promise<GitHubDeviceLogin> {
  const clientId = assertGitHubOAuthClientId();
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ client_id: clientId, scope: githubOAuthScopes() }),
  });
  if (!res.ok) {
    throw new Error(`GitHub device login failed: ${res.statusText}`);
  }
  const data = (await res.json()) as GitHubDeviceCodeResponse;
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt: Date.now() + data.expires_in * 1000,
    interval: data.interval,
  };
}

export async function pollGitHubDeviceLogin(deviceCode: string): Promise<
  | { status: "pending"; interval?: number }
  | { status: "expired" }
  | { status: "authorized"; token: string; login: string; scopes: string[] }
> {
  const clientId = assertGitHubOAuthClientId();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub device login failed: ${res.statusText}`);
  }
  const data = (await res.json()) as GitHubAccessTokenResponse;
  if (data.access_token) {
    const { login, scopes } = await verifyPat(data.access_token);
    return { status: "authorized", token: data.access_token, login, scopes };
  }
  if (data.error === "authorization_pending") return { status: "pending" };
  if (data.error === "slow_down") return { status: "pending", interval: 10 };
  if (data.error === "expired_token") return { status: "expired" };
  throw new Error(data.error_description ?? data.error ?? "GitHub login failed.");
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
