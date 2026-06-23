import { useState } from 'react';
import { api, type ApproveResult } from './api';

interface Props {
  projectId: string;
  currentVersion: number;
  onClose: () => void;
  onApproved: (result: ApproveResult) => void;
}

export function ApproveModal({ projectId, currentVersion, onClose, onApproved }: Props) {
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    const outcome = await api.approveProject(projectId, startNow);
    setBusy(false);
    if (outcome.ok) {
      onApproved(outcome.result);
    } else {
      setError(outcome.error);
    }
  }

  const steps = [
    { title: 'Create / reuse "arbor" label', sub: 'Filters all Arbor-created work in GitHub' },
    { title: 'Create milestone', sub: 'One per project, groups every ticket issue' },
    { title: 'Create a GitHub issue per ticket', sub: 'Durable record before any agent runs' },
  ];

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
      onClick={busy ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '92vw',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 30px 80px -20px rgba(20,14,6,.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '22px 24px 16px' }}>
          <div className="serif" style={{ fontSize: 23, color: 'var(--ink)' }}>
            Approve &amp; create on GitHub
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4, lineHeight: 1.5 }}>
            Locks graph <b>v{currentVersion}</b> as authoritative and creates durable records. Draft edits stop here.
          </div>
        </div>
        <div style={{ padding: '0 24px' }}>
          {steps.map((s) => (
            <div key={s.title} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid var(--border)' }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 99,
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                  fontSize: 13,
                }}
              >
                ✓
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{s.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.sub}</div>
              </div>
            </div>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 24px 0', padding: '12px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
          <button
            onClick={() => setStartNow(!startNow)}
            style={{
              width: 18,
              height: 18,
              borderRadius: 5,
              border: `1.5px solid ${startNow ? 'var(--accent)' : 'var(--border2)'}`,
              background: startNow ? 'var(--accent)' : 'transparent',
              color: '#fff',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            {startNow ? '✓' : ''}
          </button>
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>
            Start execution now <span style={{ color: 'var(--muted)' }}>— begin scheduling root tickets immediately</span>
          </span>
        </label>
        {error && <div style={{ margin: '12px 24px 0', color: 'oklch(0.57 0.14 28)', fontSize: 12.5 }}>{error}</div>}
        <div style={{ padding: '16px 24px 22px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{ padding: '10px 16px', borderRadius: 9, fontSize: 13.5, fontWeight: 600, color: 'var(--ink2)', background: 'var(--panel2)', border: '1px solid var(--border)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            style={{
              padding: '10px 18px',
              borderRadius: 9,
              fontSize: 13.5,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--accent)',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Creating on GitHub…' : 'Approve & create'}
          </button>
        </div>
      </div>
    </div>
  );
}
