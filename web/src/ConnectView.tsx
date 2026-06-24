import { useRef, useState } from 'react';
import { api, type GitHubRemote, type Repository } from './api';

interface Props {
  onConnected: (repo: Repository) => void;
}

type Step = 0 | 1 | 2;

// The File System Access API is not yet in the lib.dom typings everywhere.
interface DirectoryPickerWindow {
  showDirectoryPicker?: () => Promise<{ name: string }>;
}

export function ConnectView({ onConnected }: Props) {
  const [step, setStep] = useState<Step>(0);
  const [localPath, setLocalPath] = useState('');
  const [pickerNote, setPickerNote] = useState<string | null>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [defaultBranch, setDefaultBranch] = useState('');
  const [clean, setClean] = useState(true);
  const [remotes, setRemotes] = useState<GitHubRemote[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<GitHubRemote | null>(null);
  const [token, setToken] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authDone, setAuthDone] = useState(false);
  const [login, setLogin] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);

  async function handleInspect() {
    setInspectError(null);
    try {
      const result = await api.inspectRepo(localPath.trim());
      setClean(result.clean);
      setDefaultBranch(result.defaultBranch);
      setRemotes(result.remotes);
      setSelectedRemote(result.preferred ?? result.remotes[0] ?? null);
      setStep(1);
    } catch (err) {
      setInspectError((err as Error).message);
    }
  }

  async function handleBrowse() {
    setPickerNote(null);
    try {
      const selected = await api.browseRepoPath();
      if (selected?.localPath) {
        setLocalPath(selected.localPath);
        return;
      }
      return;
    } catch {
      // Fall back to browser-native pickers when the local server cannot open a native dialog.
    }

    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (picker) {
      try {
        const handle = await picker();
        setLocalPath(handle.name);
        setPickerNote(
          'Your browser only exposes the folder name, not its full path. Edit the field to the absolute path if needed.',
        );
      } catch (err) {
        // AbortError means the user dismissed the picker — not an error to surface.
        if ((err as Error).name !== 'AbortError') {
          setPickerNote('Could not open the directory picker. Type or paste the path instead.');
        }
      }
      return;
    }
    // Fallback for browsers without the File System Access API.
    if (dirInputRef.current) {
      dirInputRef.current.click();
    } else {
      setPickerNote('Directory selection is not supported in this browser. Type or paste the path instead.');
    }
  }

  function handleDirInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPickerNote(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // webkitRelativePath looks like "selected-dir/sub/file"; the first segment is the chosen folder.
    const first = files[0];
    const relative = (first as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    const dirName = relative.split('/')[0] || first.name;
    setLocalPath(dirName);
    setPickerNote(
      'Your browser only exposes the folder name, not its full path. Edit the field to the absolute path if needed.',
    );
    // Allow re-selecting the same directory later.
    e.target.value = '';
  }

  async function handleAuthorize() {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await api.verifyToken(token.trim());
      setLogin(result.login);
      setScopes(result.scopes);
      setAuthDone(true);
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleFinish() {
    if (!selectedRemote) return;
    setConnecting(true);
    try {
      const repo = await api.connectRepo({
        localPath: localPath.trim(),
        owner: selectedRemote.owner,
        name: selectedRemote.name,
        defaultBranch,
        token: token.trim(),
      });
      onConnected(repo);
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div
        style={{
          width: 760,
          maxWidth: '100%',
          display: 'flex',
          border: '1px solid var(--border)',
          borderRadius: 16,
          overflow: 'hidden',
          background: 'var(--panel)',
          boxShadow: '0 12px 40px -16px var(--shadow)',
        }}
      >
        <div
          style={{
            width: 248,
            flex: 'none',
            background: 'var(--panel2)',
            padding: '28px 24px',
            borderRight: '1px solid var(--border)',
          }}
        >
          <div className="serif" style={{ fontSize: 24, color: 'var(--ink)', marginBottom: 4 }}>
            Connect a repo
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5, marginBottom: 26 }}>
            Point Arbor at an existing local checkout. We never clone.
          </div>
          {[
            { title: 'Select local repository', sub: 'An existing git checkout', done: step > 0 },
            { title: 'GitHub remote detected', sub: 'origin or a chosen remote', done: step > 1 },
            { title: 'Authorize GitHub', sub: 'Token stored in OS keychain', done: authDone },
          ].map((c, i) => (
            <div key={c.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 20 }}>
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 99,
                  border: `1.5px solid ${c.done ? 'var(--accent)' : 'var(--border2)'}`,
                  background: c.done ? 'var(--accent)' : 'transparent',
                  color: '#fff',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                }}
              >
                {c.done ? '✓' : i + 1}
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: step === i ? 'var(--ink)' : 'var(--ink2)' }}>
                  {c.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.sub}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, padding: '32px 30px', display: 'flex', flexDirection: 'column', minHeight: 340 }}>
          {step === 0 && (
            <div style={{ flex: 1 }}>
              <StepLabel n={1} />
              <div className="serif" style={{ fontSize: 23, color: 'var(--ink)', marginBottom: 18 }}>
                Select local repository
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                <input
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="/Users/you/code/your-repo"
                  className="mono"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13,
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1.5px solid var(--border2)',
                    background: 'var(--bg)',
                    color: 'var(--ink)',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  style={{
                    flex: 'none',
                    padding: '12px 18px',
                    borderRadius: 10,
                    border: '1.5px solid var(--border2)',
                    background: 'var(--panel2)',
                    color: 'var(--ink)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Browse…
                </button>
                <input
                  ref={dirInputRef}
                  type="file"
                  onChange={handleDirInputChange}
                  style={{ display: 'none' }}
                  {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                />
              </div>
              {pickerNote && (
                <div style={{ color: 'var(--ink2)', fontSize: 12.5, marginTop: 10 }}>{pickerNote}</div>
              )}
              {inspectError && (
                <div style={{ color: 'oklch(0.57 0.14 28)', fontSize: 12.5, marginTop: 10 }}>{inspectError}</div>
              )}
            </div>
          )}

          {step === 1 && (
            <div style={{ flex: 1 }}>
              <StepLabel n={2} />
              <div className="serif" style={{ fontSize: 23, color: 'var(--ink)', marginBottom: 6 }}>
                GitHub remote detected
              </div>
              {remotes.length === 0 && (
                <div style={{ fontSize: 13, color: 'oklch(0.57 0.14 28)' }}>
                  No GitHub remotes found on this checkout.
                </div>
              )}
              {remotes.map((r) => (
                <button
                  key={r.remoteName}
                  onClick={() => setSelectedRemote(r)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: `1.5px solid ${selectedRemote?.remoteName === r.remoteName ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 12,
                    padding: 16,
                    background: selectedRemote?.remoteName === r.remoteName ? 'var(--accent-soft)' : 'var(--bg)',
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 99,
                      border: '5px solid var(--accent)',
                      flex: 'none',
                      opacity: selectedRemote?.remoteName === r.remoteName ? 1 : 0.25,
                    }}
                  />
                  <div>
                    <div className="mono" style={{ fontSize: 13, color: 'var(--ink)' }}>
                      {r.remoteName} → github.com/{r.owner}/{r.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>
                      default branch: <code className="mono">{defaultBranch}</code>
                      {!clean && ' · working tree has uncommitted changes'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div style={{ flex: 1 }}>
              <StepLabel n={3} />
              <div className="serif" style={{ fontSize: 23, color: 'var(--ink)', marginBottom: 6 }}>
                Authorize GitHub
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 18, lineHeight: 1.5 }}>
                Paste a personal access token with <code className="mono">repo</code> and{' '}
                <code className="mono">read:org</code> scopes. Arbor verifies it, then stores it in your OS keychain
                — never in the local database.
              </div>
              {authDone ? (
                <div
                  style={{
                    border: '1.5px solid var(--accent)',
                    borderRadius: 12,
                    padding: 16,
                    background: 'var(--accent-soft)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 18, color: 'var(--accent)' }}>✓</span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>API access verified — {login}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink2)' }}>scopes: {scopes.join(', ') || 'unknown'}</div>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    type="password"
                    placeholder="ghp_…"
                    className="mono"
                    style={{
                      width: '100%',
                      fontSize: 13,
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: '1.5px solid var(--border2)',
                      background: 'var(--bg)',
                      color: 'var(--ink)',
                      outline: 'none',
                      marginBottom: 12,
                    }}
                  />
                  <button
                    onClick={handleAuthorize}
                    disabled={!token.trim() || authBusy}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '13px 18px',
                      borderRadius: 10,
                      background: 'var(--ink)',
                      color: 'var(--bg)',
                      fontSize: 14,
                      fontWeight: 600,
                      opacity: !token.trim() || authBusy ? 0.6 : 1,
                    }}
                  >
                    {authBusy ? 'Verifying…' : 'Verify & continue'}
                  </button>
                  {authError && (
                    <div style={{ color: 'oklch(0.57 0.14 28)', fontSize: 12.5, marginTop: 10 }}>{authError}</div>
                  )}
                </>
              )}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              paddingTop: 18,
              borderTop: '1px solid var(--border)',
              marginTop: 18,
            }}
          >
            <NextButton
              step={step}
              localPath={localPath}
              selectedRemote={selectedRemote}
              authDone={authDone}
              connecting={connecting}
              onInspect={handleInspect}
              onNext={() => setStep((s) => ((s + 1) as Step))}
              onFinish={handleFinish}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StepLabel({ n }: { n: number }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.07em',
        textTransform: 'uppercase',
        color: 'var(--accent)',
        marginBottom: 10,
      }}
    >
      Step {n}
    </div>
  );
}

function NextButton({
  step,
  localPath,
  selectedRemote,
  authDone,
  connecting,
  onInspect,
  onNext,
  onFinish,
}: {
  step: Step;
  localPath: string;
  selectedRemote: GitHubRemote | null;
  authDone: boolean;
  connecting: boolean;
  onInspect: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  const baseStyle: React.CSSProperties = {
    padding: '11px 20px',
    borderRadius: 9,
    fontSize: 13.5,
    fontWeight: 600,
    background: 'var(--accent)',
    color: '#fff',
  };
  const style = (disabled: boolean): React.CSSProperties => ({
    ...baseStyle,
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'default' : 'pointer',
  });
  if (step === 0) {
    return (
      <button style={style(!localPath.trim())} disabled={!localPath.trim()} onClick={onInspect}>
        Continue →
      </button>
    );
  }
  if (step === 1) {
    return (
      <button style={style(!selectedRemote)} disabled={!selectedRemote} onClick={onNext}>
        Continue →
      </button>
    );
  }
  return (
    <button style={style(!authDone || connecting)} disabled={!authDone || connecting} onClick={onFinish}>
      {connecting ? 'Connecting…' : 'Finish'}
    </button>
  );
}
