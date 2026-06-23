import { useState } from 'react';
import { api, type Project } from './api';

interface Props {
  repositoryId: string;
  onCreated: (project: Project) => void;
}

export function NewProjectView({ repositoryId, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({ repositoryId, title: title.trim(), objective: objective.trim() });
      onCreated(project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div
        style={{
          width: 520,
          maxWidth: '100%',
          border: '1px solid var(--border)',
          borderRadius: 16,
          background: 'var(--panel)',
          boxShadow: '0 12px 40px -16px var(--shadow)',
          padding: 30,
        }}
      >
        <div className="serif" style={{ fontSize: 24, color: 'var(--ink)', marginBottom: 4 }}>
          New project
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 22, lineHeight: 1.5 }}>
          A project is one repo-scoped objective with one approved ticket DAG.
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 7 }}>Title</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Passwordless auth"
          style={{
            width: '100%',
            fontSize: 13,
            padding: '11px 13px',
            borderRadius: 10,
            border: '1.5px solid var(--border2)',
            background: 'var(--bg)',
            color: 'var(--ink)',
            outline: 'none',
            marginBottom: 18,
          }}
        />
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 7 }}>Objective</div>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="Describe what you want built, in plain language…"
          rows={4}
          style={{
            width: '100%',
            fontSize: 13,
            padding: '11px 13px',
            borderRadius: 10,
            border: '1.5px solid var(--border2)',
            background: 'var(--bg)',
            color: 'var(--ink)',
            outline: 'none',
            resize: 'vertical',
            marginBottom: 18,
          }}
        />
        {error && <div style={{ color: 'oklch(0.57 0.14 28)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        <button
          onClick={handleCreate}
          disabled={!title.trim() || !objective.trim() || busy}
          style={{
            padding: '11px 20px',
            borderRadius: 9,
            fontSize: 13.5,
            fontWeight: 600,
            background: 'var(--accent)',
            color: '#fff',
            opacity: !title.trim() || !objective.trim() || busy ? 0.45 : 1,
          }}
        >
          {busy ? 'Creating…' : 'Start planning →'}
        </button>
      </div>
    </div>
  );
}
