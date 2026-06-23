const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const detail = Array.isArray(body.errors) && body.errors.length ? `: ${body.errors.join('; ')}` : '';
    throw new Error(`${body.error ?? `Request failed: ${res.status}`}${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Repository {
  id: string;
  local_path: string;
  owner: string;
  name: string;
  default_branch: string;
  created_at: string;
}

export interface GitHubRemote {
  remoteName: string;
  owner: string;
  name: string;
}

export interface InspectResult {
  localPath: string;
  clean: boolean;
  defaultBranch: string;
  remotes: GitHubRemote[];
  preferred?: GitHubRemote;
}

export interface DraftTicket {
  id: string;
  title: string;
  problem: string;
  acceptanceCriteria: string[];
  implementationNotes?: string;
  dependsOn: string[];
}

export interface Project {
  id: string;
  repository_id: string;
  title: string;
  objective: string;
  status: 'draft' | 'approval_failed' | 'approved' | 'running' | 'done';
  milestone_number: number | null;
  milestone_url: string | null;
  label_name: string;
  base_branch: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  project_id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  created_at: string;
}

export interface ProjectState {
  project: Project;
  tickets: DraftTicket[];
  currentVersion: number;
  versions: { versionNumber: number; createdAt: string }[];
  messages: ChatMessage[];
}

export interface SettingsState {
  githubConnected: boolean;
  anthropicConnected: boolean;
  agentCommand: string;
  maxConcurrency: number;
}

export interface Ticket {
  id: string;
  project_id: string;
  stable_key: string;
  number: number;
  title: string;
  problem: string;
  acceptance_criteria_json: string;
  implementation_notes: string | null;
  status: 'draft' | 'blocked' | 'ready' | 'running' | 'review' | 'merged' | 'failed';
  github_issue_number: number | null;
  github_issue_url: string | null;
  branch_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApproveResult {
  project: Project;
  tickets: Ticket[];
}

export interface Run {
  id: string;
  ticket_id: string;
  attempt_number: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  pr_number: number | null;
  pr_url: string | null;
  log_path: string | null;
  session_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface TicketWithRuns extends Ticket {
  dependsOn: string[];
  runs: Run[];
}

export interface RunState {
  project: Project;
  tickets: TicketWithRuns[];
}

export const api = {
  listRepos: () => request<Repository[]>('/repos'),
  inspectRepo: (localPath: string) =>
    request<InspectResult>('/repos/inspect', { method: 'POST', body: JSON.stringify({ localPath }) }),
  verifyToken: (token: string) =>
    request<{ ok: true; login: string; scopes: string[] }>('/repos/verify-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  connectRepo: (params: { localPath: string; owner: string; name: string; defaultBranch: string; token: string }) =>
    request<Repository>('/repos', { method: 'POST', body: JSON.stringify(params) }),
  authStatus: () => request<{ connected: boolean }>('/repos/auth-status'),

  listProjects: () => request<Project[]>('/projects'),
  createProject: (params: { repositoryId: string; title: string; objective: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(params) }),
  getProject: (id: string) => request<ProjectState>(`/projects/${id}`),
  sendChat: (id: string, message: string, pinnedPaths: string[]) =>
    request<ProjectState>(`/projects/${id}/chat`, { method: 'POST', body: JSON.stringify({ message, pinnedPaths }) }),
  editTicket: (projectId: string, ticketId: string, fields: Partial<DraftTicket>) =>
    request<ProjectState>(`/projects/${projectId}/tickets/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }),
  addDependency: (projectId: string, ticketId: string, dependsOn: string) =>
    request<ProjectState>(`/projects/${projectId}/tickets/${ticketId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOn }),
    }),
  removeDependency: (projectId: string, ticketId: string, depId: string) =>
    request<ProjectState>(`/projects/${projectId}/tickets/${ticketId}/dependencies/${depId}`, { method: 'DELETE' }),
  deleteTicket: (projectId: string, ticketId: string) =>
    request<ProjectState>(`/projects/${projectId}/tickets/${ticketId}`, { method: 'DELETE' }),

  approveProject: async (
    projectId: string,
    startNow: boolean
  ): Promise<{ ok: true; result: ApproveResult } | { ok: false; error: string; result?: ApproveResult }> => {
    const res = await fetch(`${BASE}/projects/${projectId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startNow }),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, error: body.error ?? `Request failed: ${res.status}`, result: body };
    return { ok: true, result: body };
  },

  getRunState: (projectId: string) => request<RunState>(`/projects/${projectId}/run-state`),
  refresh: (projectId: string) => request<RunState>(`/projects/${projectId}/refresh`, { method: 'POST' }),

  getSettings: () => request<SettingsState>('/settings'),
  setAnthropicKey: (apiKey: string) =>
    request<{ ok: true }>('/settings/anthropic-key', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  setAgentCommand: (agentCommand: string) =>
    request<{ ok: true }>('/settings/agent-command', { method: 'PUT', body: JSON.stringify({ agentCommand }) }),
  setMaxConcurrency: (maxConcurrency: number) =>
    request<{ ok: true }>('/settings/max-concurrency', { method: 'PUT', body: JSON.stringify({ maxConcurrency }) }),
};
