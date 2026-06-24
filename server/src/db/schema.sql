CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  local_path TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approval_failed','approved','running','done')),
  milestone_number INTEGER,
  milestone_url TEXT,
  label_name TEXT NOT NULL DEFAULT 'arbor',
  base_branch TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS graph_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_number INTEGER NOT NULL,
  tickets_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, version_number)
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  stable_key TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  problem TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL,
  implementation_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','blocked','ready','running','review','merged','failed')),
  github_issue_number INTEGER,
  github_issue_url TEXT,
  branch_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, stable_key)
);

CREATE TABLE IF NOT EXISTS dependencies (
  project_id TEXT NOT NULL REFERENCES projects(id),
  ticket_stable_key TEXT NOT NULL,
  depends_on_stable_key TEXT NOT NULL,
  PRIMARY KEY (project_id, ticket_stable_key, depends_on_stable_key)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  pr_number INTEGER,
  pr_url TEXT,
  log_path TEXT,
  session_id TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
