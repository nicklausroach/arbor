import { useEffect, useState } from 'react';
import { api, type SettingsState } from './api';

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [agentCommand, setAgentCommand] = useState('');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setAgentCommand(s.agentCommand);
    });
  }, []);

  async function saveAnthropicKey() {
    if (!anthropicKey.trim()) return;
    await api.setAnthropicKey(anthropicKey.trim());
    setAnthropicKey('');
    setSettings(await api.getSettings());
    setSavedMsg('Anthropic key saved to keychain.');
  }

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
            <StatusRow ok={settings?.githubConnected} label={settings?.githubConnected ? 'Token in OS keychain' : 'Not connected — connect a repo first'} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 7 }}>Anthropic API key</div>
            <StatusRow ok={settings?.anthropicConnected} label={settings?.anthropicConnected ? 'Key in OS keychain' : 'Not set — planner chat will fail'} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                type="password"
                placeholder="sk-ant-…"
                className="mono"
                style={{ flex: 1, fontSize: 12.5, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }}
              />
              <button
                onClick={saveAnthropicKey}
                disabled={!anthropicKey.trim()}
                style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: 'var(--accent)', borderRadius: 8, padding: '0 14px', opacity: !anthropicKey.trim() ? 0.5 : 1 }}
              >
                Save
              </button>
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
