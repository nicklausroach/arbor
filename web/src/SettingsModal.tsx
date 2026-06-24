import { useEffect, useState } from 'react';
import { api, type Repository, type SettingsState } from './api';

interface Props {
  repos: Repository[];
  currentRepoId: string | null;
  onDeleteRepo: (id: string) => void;
  onClose: () => void;
}

export function SettingsModal({ repos, currentRepoId, onDeleteRepo, onClose }: Props) {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [agentCommand, setAgentCommand] = useState('');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setAgentCommand(s.agentCommand);
    });
  }, []);

  async function saveAgentCommand() {
    await api.setAgentCommand(agentCommand.trim());
    setSettings(await api.getSettings());
    setSavedMsg('Agent command saved.');
  }

  async function setConcurrency(n: number) {
    await api.setMaxConcurrency(n);
    setSettings(await api.getSettings());
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,14,6,.42)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: '92vw',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 30px 80px -20px rgba(20,14,6,.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '22px 24px 18px', borderBottom: '1px solid var(--border)' }}>
          <div className="serif" style={{ fontSize: 23, color: 'var(--ink)' }}>
            Settings
          </div>
        </div>
        <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 7 }}>GitHub authentication</div>
            <StatusRow ok={settings?.githubConnected} label={settings?.githubConnected ? 'GitHub App installed' : 'Not connected — install the GitHub App while connecting a repo'} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 7 }}>Repositories</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {repos.map((repo) => (
                <div
                  key={repo.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {repo.owner}/{repo.name}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: repo.id === currentRepoId ? 'var(--accent)' : 'var(--muted)', marginTop: 2 }}>
                      {repo.id === currentRepoId ? 'current' : repo.default_branch}
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteRepo(repo.id)}
                    style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'oklch(0.57 0.14 28)' }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 7 }}>Planner (Claude Code)</div>
            <StatusRow ok={settings?.claudeAvailable} label={settings?.claudeAvailable ? 'claude found on PATH' : 'claude not found — install Claude Code to plan'} />
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
              Planning runs through Claude Code using its own session auth. No API key needed.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 7 }}>Agent command</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={agentCommand}
                onChange={(e) => setAgentCommand(e.target.value)}
                onBlur={saveAgentCommand}
                className="mono"
                style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 10, padding: '11px 13px', outline: 'none' }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
              Run per ticket with cwd set to the worktree; prompt is piped via stdin.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 7 }}>Max concurrency</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setConcurrency(n)}
                  style={{
                    width: 40,
                    height: 36,
                    borderRadius: 9,
                    fontSize: 13,
                    fontWeight: 600,
                    border: `1.5px solid ${settings?.maxConcurrency === n ? 'var(--accent)' : 'var(--border)'}`,
                    background: settings?.maxConcurrency === n ? 'var(--accent-soft)' : 'var(--bg)',
                    color: 'var(--ink)',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
              Global limit on simultaneously running agents. Default 1 is safest.
            </div>
          </div>
          {savedMsg && <div style={{ fontSize: 12, color: 'var(--accent)' }}>{savedMsg}</div>}
        </div>
        <div style={{ padding: '16px 24px 22px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: 9, fontSize: 13.5, fontWeight: 600, color: '#fff', background: 'var(--accent)' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)' }}>
      <span style={{ fontSize: 16, color: ok ? 'var(--accent)' : 'var(--muted)' }}>{ok ? '✓' : '○'}</span>
      <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{label}</div>
    </div>
  );
}
