import { useState } from 'react';
import { api, type ApproveResult, type ApproveStep, type ApproveStepStatus } from './api';

interface Props {
  projectId: string;
  currentVersion: number;
  onClose: () => void;
  onApproved: (result: ApproveResult) => void;
}

type StepState = 'pending' | ApproveStepStatus;

function StepIcon({ state }: { state: StepState }) {
  if (state === 'running') {
    return (
      <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 99,
            border: '2px solid var(--border2)',
            borderTopColor: 'var(--accent)',
            animation: 'ar-spin 0.7s linear infinite',
            display: 'inline-block',
          }}
        />
      </div>
    );
  }
  const bg = state === 'done' ? 'var(--accent-soft)' : state === 'error' ? 'oklch(0.9 0.05 28)' : 'var(--panel2)';
  const color = state === 'done' ? 'var(--accent)' : state === 'error' ? 'oklch(0.57 0.14 28)' : 'var(--muted)';
  const glyph = state === 'done' ? '✓' : state === 'error' ? '✕' : '·';
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 99,
        background: bg,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        fontSize: 13,
      }}
    >
      {glyph}
    </div>
  );
}

export function ApproveModal({ projectId, currentVersion, onClose, onApproved }: Props) {
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepState, setStepState] = useState<Record<ApproveStep, StepState>>({
    label: 'pending',
    milestone: 'pending',
    issues: 'pending',
  });

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    setStepState({ label: 'pending', milestone: 'pending', issues: 'pending' });
    const outcome = await api.approveProject(projectId, startNow, (step, status) => {
      setStepState((prev) => ({ ...prev, [step]: status }));
    });
    setBusy(false);
    if (outcome.ok) {
      onApproved(outcome.result);
    } else {
      setError(outcome.error);
    }
  }

  const steps: { id: ApproveStep; title: string; sub: string }[] = [
    { id: 'label', title: 'Create / reuse "arbor" label', sub: 'Filters all Arbor-created work in GitHub' },
    { id: 'milestone', title: 'Create milestone', sub: 'One per project, groups every ticket issue' },
    { id: 'issues', title: 'Create a GitHub issue per ticket', sub: 'Durable record before any agent runs' },
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
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid var(--border)' }}>
              <StepIcon state={stepState[s.id]} />
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
