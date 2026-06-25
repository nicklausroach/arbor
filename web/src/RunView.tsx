import { useEffect, useState } from 'react';
import { api, type RunState, type TicketWithRuns } from './api';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './dagLayout';
import { GraphViewport } from './GraphViewport';
import { IntegratedTerminal } from './IntegratedTerminal';

const SESSION_ELIGIBLE_STATUSES = new Set(['running', 'review', 'failed']);

interface Props {
  projectId: string;
}

const STATUS_META: Record<string, { label: string; color: string; soft: string }> = {
  draft: { label: 'Draft', color: 'var(--muted)', soft: 'var(--panel2)' },
  blocked: { label: 'Blocked', color: 'oklch(0.62 0.1 65)', soft: 'oklch(0.92 0.05 65 / 0.45)' },
  ready: { label: 'Ready', color: 'oklch(0.55 0.09 150)', soft: 'oklch(0.9 0.05 150 / 0.45)' },
  running: { label: 'Running', color: 'oklch(0.54 0.1 245)', soft: 'oklch(0.9 0.05 245 / 0.45)' },
  review: { label: 'In review', color: 'oklch(0.54 0.11 300)', soft: 'oklch(0.9 0.05 300 / 0.45)' },
  merged: { label: 'Merged', color: 'oklch(0.5 0.09 150)', soft: 'oklch(0.88 0.06 150 / 0.45)' },
  failed: { label: 'Failed', color: 'oklch(0.57 0.14 28)', soft: 'oklch(0.9 0.06 28 / 0.45)' },
};

export function RunView({ projectId }: Props) {
  const [state, setState] = useState<RunState | null>(null);
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [session, setSession] = useState<{ runId: string; ticketNumber: number; branch: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next = await api.getRunState(projectId);
      if (!cancelled) setState(next);
    }
    load();
    // Ticket statuses advance server-side every scheduler tick (~10s), so poll on a
    // comparable cadence — at 60s the graph sat visibly stale right after kickoff. (#62)
    const pollId = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [projectId]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      setState(await api.refresh(projectId));
    } finally {
      setRefreshing(false);
    }
  }

  if (!state) return <div style={{ flex: 1, padding: 40 }}>Loading…</div>;

  const { tickets } = state;
  const nodes = tickets.map((t) => ({ id: t.stable_key, dependsOn: t.dependsOn }));
  const layout = layoutGraph(nodes);
  const byKey = new Map(tickets.map((t) => [t.stable_key, t]));
  const drawerTicket = drawerKey ? byKey.get(drawerKey) ?? null : null;

  const stat = {
    merged: tickets.filter((t) => t.status === 'merged').length,
    running: tickets.filter((t) => t.status === 'running').length,
    ready: tickets.filter((t) => t.status === 'ready').length,
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '18px 22px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel)',
        }}
      >
        <div style={{ flex: 'none' }}>
          <div className="serif" style={{ fontSize: 18, color: 'var(--ink)', lineHeight: 1.1 }}>
            {state.project.title}
          </div>
          {state.project.milestone_url && (
            <a href={state.project.milestone_url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              milestone #{state.project.milestone_number}
            </a>
          )}
        </div>
        <StatusBadge status={state.project.status} />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--ink2)' }}>
          <span>
            <b style={{ color: 'var(--ink)' }}>{stat.merged}</b> merged
          </span>
          <span>
            <b style={{ color: 'var(--ink)' }}>{stat.running}</b> running
          </span>
          <span>
            <b style={{ color: 'var(--ink)' }}>{stat.ready}</b> ready
          </span>
        </div>
        <button
          onClick={() => {
            setDrawerKey(null);
            setSummaryOpen((open) => !open);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '8px 14px',
            borderRadius: 9,
            background: summaryOpen ? 'var(--ink)' : 'var(--panel2)',
            border: '1px solid var(--border)',
            color: summaryOpen ? 'var(--bg)' : 'var(--ink)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ⓘ Summary
        </button>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '8px 14px',
            borderRadius: 9,
            background: 'var(--panel2)',
            border: '1px solid var(--border)',
            color: 'var(--ink)',
            fontSize: 13,
            fontWeight: 600,
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          ↻ {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <GraphViewport
          width={layout.width}
          height={layout.height}
          overlay={
            summaryOpen ? (
              <ProjectSummaryDrawer
                project={state.project}
                tickets={tickets}
                onClose={() => setSummaryOpen(false)}
                onSelectTicket={(stableKey) => {
                  setSummaryOpen(false);
                  setDrawerKey(stableKey);
                }}
              />
            ) : (
              drawerTicket && (
                <RunDrawer
                  ticket={drawerTicket}
                  onClose={() => setDrawerKey(null)}
                  onConnectSession={(runId) =>
                    setSession({ runId, ticketNumber: drawerTicket.number, branch: drawerTicket.branch_name ?? '' })
                  }
                />
              )
            )
          }
        >
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {layout.edges.map((e) => {
              const upMerged = byKey.get(e.from)?.status === 'merged';
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={e.d}
                  fill="none"
                  stroke={upMerged ? 'var(--accent)' : 'var(--border2)'}
                  strokeWidth={upMerged ? 2 : 1.5}
                  strokeDasharray={upMerged ? '0' : '5 5'}
                />
              );
            })}
          </svg>
          {layout.nodes.map((n) => {
            const t = byKey.get(n.id)!;
            const meta = STATUS_META[t.status] ?? STATUS_META.draft;
            const sel = drawerKey === n.id;
            const pulsing = t.status === 'running';
            const worktreeName = formatWorktreeName(t.branch_name);
            return (
              <button
                key={n.id}
                onClick={() => {
                  setSummaryOpen(false);
                  setDrawerKey(n.id);
                }}
                style={{
                  position: 'absolute',
                  left: n.x,
                  top: n.y,
                  width: NODE_WIDTH,
                  height: NODE_HEIGHT,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: 'var(--panel)',
                  borderTop: `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                  borderRight: `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                  borderBottom: `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                  borderLeft: `3px solid ${meta.color}`,
                  borderRadius: 11,
                  padding: '12px 13px 10px',
                  boxShadow: sel ? '0 8px 24px -6px var(--shadow)' : '0 1px 2px var(--shadow)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6, flex: 'none' }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                    #{t.number}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 99,
                      color: meta.color,
                      background: meta.soft,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: meta.color, animation: pulsing ? 'ar-pulse 1.3s infinite' : 'none' }} />
                    {meta.label}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1.28,
                    color: 'var(--ink)',
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                    minHeight: 0,
                  }}
                >
                  {t.title}
                </div>
                <div
                  className="mono"
                  title={worktreeName}
                  style={{
                    fontSize: 10.5,
                    color: 'var(--muted)',
                    marginTop: 'auto',
                    flex: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {worktreeName}
                </div>
              </button>
            );
          })}
        </GraphViewport>
      </div>
      {session && (
        <IntegratedTerminal
          runId={session.runId}
          ticketNumber={session.ticketNumber}
          branch={session.branch}
          onClose={() => setSession(null)}
        />
      )}
    </div>
  );
}

function formatWorktreeName(branchName?: string | null): string {
  if (!branchName) return '';
  return `.../${branchName.split('/').pop() ?? branchName}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string; border: string }> = {
    approved: { label: 'Approved', color: 'var(--ink2)', bg: 'var(--panel2)', border: 'var(--border)' },
    running: { label: 'Running', color: 'oklch(0.5 0.1 245)', bg: 'oklch(0.9 0.05 245 / .4)', border: 'oklch(0.8 0.06 245 / .4)' },
    done: { label: 'Done', color: 'oklch(0.5 0.09 150)', bg: 'oklch(0.9 0.05 150 / .4)', border: 'oklch(0.8 0.06 150 / .4)' },
  };
  const m = map[status] ?? map.approved;
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '4px 12px',
        borderRadius: 99,
        fontSize: 11.5,
        fontWeight: 600,
        background: m.bg,
        color: m.color,
        border: `1px solid ${m.border}`,
      }}
    >
      {status === 'running' && <span style={{ width: 7, height: 7, borderRadius: 99, background: m.color, animation: 'ar-pulse 1.4s infinite' }} />}
      {m.label}
    </span>
  );
}

function RunDrawer({
  ticket,
  onClose,
  onConnectSession,
}: {
  ticket: TicketWithRuns;
  onClose: () => void;
  onConnectSession: (runId: string) => void;
}) {
  const latestRun = ticket.runs[ticket.runs.length - 1];
  const meta = STATUS_META[ticket.status] ?? STATUS_META.draft;
  const [log, setLog] = useState<string | null>(null);
  const canConnect = SESSION_ELIGIBLE_STATUSES.has(ticket.status) && Boolean(latestRun?.session_id);

  return (
    <div
      data-nopan
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        bottom: 14,
        width: 392,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: '0 16px 44px -16px var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '15px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            #{ticket.number}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, color: meta.color, background: meta.soft }}>
            {meta.label}
          </span>
          <button onClick={onClose} style={{ color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: 2 }}>
            ×
          </button>
        </div>
        <div className="serif" style={{ fontSize: 19, color: 'var(--ink)', marginTop: 8, lineHeight: 1.2 }}>
          {ticket.title}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--muted)' }}>branch</span>
          {ticket.branch_name}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {canConnect && (
          <button
            onClick={() => onConnectSession(latestRun!.id)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              padding: 12,
              borderRadius: 11,
              background: 'var(--ink)',
              color: 'var(--bg)',
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 14,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: '#62C554', animation: 'ar-pulse 1.3s infinite' }} />
            Connect to session
          </button>
        )}
        {ticket.github_issue_url && (
          <a
            href={ticket.github_issue_url}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 10, color: 'var(--ink)' }}
          >
            <span>📄</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Issue #{ticket.github_issue_number}</div>
            </div>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>↗</span>
          </a>
        )}
        {latestRun?.pr_url ? (
          <a
            href={latestRun.pr_url}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 14, color: 'var(--ink)' }}
          >
            <span>🔀</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Pull request #{latestRun.pr_number}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink2)', marginTop: 1 }}>
                {latestRun.status}
              </div>
            </div>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>↗</span>
          </a>
        ) : ticket.status === 'blocked' ? (
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, lineHeight: 1.5, marginBottom: 14 }}>
            Blocked on upstream tickets merging.
          </div>
        ) : null}

        <Label>Runs</Label>
        {ticket.runs.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No runs yet.</div>}
        {ticket.runs.map((r) => (
          <div
            key={r.id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 9, marginBottom: 7, background: 'var(--bg)' }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 99, background: runDotColor(r.status) }} />
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink)' }}>
              attempt {r.attempt_number}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.status}</span>
            {r.log_path && (
              <button
                onClick={async () => setLog(await fetch(`/api/runs/${r.id}/log`).then((res) => res.text()).catch(() => '(log unavailable)'))}
                style={{ fontSize: 11, color: 'var(--accent)' }}
              >
                log
              </button>
            )}
          </div>
        ))}

        {log !== null && (
          <>
            <div style={{ margin: '18px 0 8px' }}>
              <Label>Agent log</Label>
            </div>
            <div
              className="mono"
              style={{
                background: 'var(--logbg)',
                color: '#e8e2d6',
                border: '1px solid var(--border)',
                borderRadius: 9,
                padding: '11px 12px',
                fontSize: 11,
                lineHeight: 1.65,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {log}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Ticket statuses that can occur during execution, in DAG-progression order. 'draft' is
// excluded — tickets are materialized as blocked/ready at approval, never draft in RunView.
const PROGRESS_STATUSES = ['blocked', 'ready', 'running', 'review', 'merged', 'failed'] as const;

function ProjectSummaryDrawer({
  project,
  tickets,
  onClose,
  onSelectTicket,
}: {
  project: RunState['project'];
  tickets: TicketWithRuns[];
  onClose: () => void;
  onSelectTicket: (stableKey: string) => void;
}) {
  const total = tickets.length;
  const counts = Object.fromEntries(PROGRESS_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  for (const t of tickets) counts[t.status] = (counts[t.status] ?? 0) + 1;
  const merged = counts.merged ?? 0;
  const pct = total === 0 ? 0 : Math.round((merged / total) * 100);
  const failed = tickets.filter((t) => t.status === 'failed');

  return (
    <div
      data-nopan
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        bottom: 14,
        width: 392,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: '0 16px 44px -16px var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '15px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            Summary
          </span>
          <div style={{ flex: 1 }} />
          <StatusBadge status={project.status} />
          <button onClick={onClose} style={{ color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: 2 }}>
            ×
          </button>
        </div>
        <div className="serif" style={{ fontSize: 19, color: 'var(--ink)', marginTop: 8, lineHeight: 1.2 }}>
          {project.title}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <Label>Objective</Label>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink)', marginBottom: 18, whiteSpace: 'pre-wrap' }}>
          {project.objective}
        </div>

        <Label>Progress</Label>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span className="serif" style={{ fontSize: 24, color: 'var(--ink)', lineHeight: 1 }}>
            {pct}%
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {merged} of {total} tickets merged
          </span>
        </div>
        <div style={{ height: 7, borderRadius: 99, background: 'var(--panel2)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: STATUS_META.merged.color, borderRadius: 99 }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 18 }}>
          {PROGRESS_STATUSES.filter((s) => counts[s] > 0).map((s) => {
            const meta = STATUS_META[s];
            return (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink2)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: meta.color }} />
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{counts[s]}</b>
                {meta.label.toLowerCase()}
              </span>
            );
          })}
        </div>

        {failed.length > 0 && (
          <>
            <Label>Needs attention</Label>
            <div style={{ marginBottom: 18 }}>
              {failed.map((t) => (
                <button
                  key={t.stable_key}
                  onClick={() => onSelectTicket(t.stable_key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    textAlign: 'left',
                    padding: '9px 11px',
                    border: `1px solid ${STATUS_META.failed.color}`,
                    background: STATUS_META.failed.soft,
                    borderRadius: 10,
                    marginBottom: 7,
                  }}
                >
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>#{t.number}</span>
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{t.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_META.failed.color }}>Failed ↗</span>
                </button>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.5, marginTop: 4 }}>
                Failed tickets won't retry automatically and block their downstream work.
              </div>
            </div>
          </>
        )}

        <Label>Details</Label>
        <Detail label="Base branch" value={project.base_branch ?? '—'} mono />
        <Detail label="Created" value={formatCreated(project.created_at)} />
        {project.milestone_url ? (
          <a
            href={project.milestone_url}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', color: 'var(--ink)' }}
          >
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Milestone</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>#{project.milestone_number} ↗</span>
          </a>
        ) : (
          <Detail label="Milestone" value="—" />
        )}
      </div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{ fontSize: 12, color: 'var(--ink)', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

function formatCreated(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  const rel = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return `${then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${rel}`;
}

function runDotColor(status: string): string {
  if (status === 'succeeded') return 'oklch(0.55 0.09 150)';
  if (status === 'failed' || status === 'cancelled') return 'oklch(0.57 0.14 28)';
  return 'oklch(0.54 0.1 245)';
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
      {children}
    </div>
  );
}
