import { useEffect, useRef, useState } from 'react';
import { ApproveModal } from './ApproveModal';
import { api, type ApproveResult, type DraftTicket, type ProjectState } from './api';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './dagLayout';
import { GraphViewport } from './GraphViewport';

interface Props {
  projectId: string;
  onApproved: (result: ApproveResult) => void;
}

export function PlanView({ projectId, onApproved }: Props) {
  const [state, setState] = useState<ProjectState | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [pinnedInput, setPinnedInput] = useState('');
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    setState(await api.getProject(projectId));
  }

  useEffect(() => {
    refresh();
  }, [projectId]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [state?.messages.length]);

  async function handleSend() {
    const message = chatInput.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    setChatInput('');
    try {
      setState(await api.sendChat(projectId, message, pinnedPaths));
    } catch (err) {
      setError((err as Error).message);
      await refresh();
    } finally {
      setSending(false);
    }
  }

  if (!state) return <div style={{ flex: 1, padding: 40 }}>Loading…</div>;

  const { tickets } = state;
  const layout = layoutGraph(tickets);
  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          height: 58,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 22px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel)',
        }}
      >
        <div style={{ flex: 'none' }}>
          <div className="serif" style={{ fontSize: 18, color: 'var(--ink)', lineHeight: 1.1 }}>
            {state.project.title}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tickets.length} draft tickets · planning</div>
        </div>
        <span
          style={{
            padding: '4px 11px',
            borderRadius: 99,
            fontSize: 11.5,
            fontWeight: 600,
            background: 'var(--panel2)',
            color: 'var(--ink2)',
            border: '1px solid var(--border)',
          }}
        >
          Draft
        </span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          v{state.currentVersion}
        </span>
        <button
          onClick={() => setApproveOpen(true)}
          disabled={tickets.length === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            borderRadius: 9,
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 13.5,
            fontWeight: 600,
            opacity: tickets.length === 0 ? 0.5 : 1,
          }}
        >
          Approve plan →
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div
          style={{
            width: 362,
            flex: 'none',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--panel)',
          }}
        >
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border)',
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--ink2)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--accent)' }} />
            Planner
          </div>
          <div ref={chatScrollRef} style={{ flex: 1, overflow: 'auto', padding: '18px 18px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {state.messages.map((m) => (
              <ChatBubble key={m.id} role={m.role} content={m.content} />
            ))}
            {sending && <ChatBubble role="system" content="Thinking…" />}
          </div>
          {error && <div style={{ padding: '0 18px 8px', color: 'oklch(0.57 0.14 28)', fontSize: 12 }}>{error}</div>}
          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>pinned:</span>
              {pinnedPaths.map((p) => (
                <span
                  key={p}
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: 'var(--ink2)',
                    background: 'var(--panel2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '3px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {p}
                  <button onClick={() => setPinnedPaths(pinnedPaths.filter((x) => x !== p))} style={{ color: 'var(--muted)' }}>
                    ×
                  </button>
                </span>
              ))}
              <input
                value={pinnedInput}
                onChange={(e) => setPinnedInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pinnedInput.trim()) {
                    setPinnedPaths([...pinnedPaths, pinnedInput.trim()]);
                    setPinnedInput('');
                  }
                }}
                placeholder="add path + Enter"
                className="mono"
                style={{ fontSize: 11, border: 'none', outline: 'none', background: 'none', color: 'var(--ink)', flex: 1, minWidth: 90 }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
                background: 'var(--bg)',
                border: '1px solid var(--border2)',
                borderRadius: 11,
                padding: '8px 8px 8px 12px',
              }}
            >
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Describe the objective, or revise the plan…"
                rows={2}
                style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'none', color: 'var(--ink)', fontSize: 13, lineHeight: 1.4, maxHeight: 80 }}
              />
              <button
                onClick={handleSend}
                disabled={sending || !chatInput.trim()}
                style={{
                  width: 30,
                  height: 30,
                  flex: 'none',
                  borderRadius: 8,
                  background: 'var(--accent)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  opacity: sending || !chatInput.trim() ? 0.5 : 1,
                }}
              >
                ↑
              </button>
            </div>
          </div>
        </div>

        <GraphViewport
          width={layout.width}
          height={layout.height}
          overlay={
            selected && (
              <TicketInspector
                key={selected.id}
                projectId={projectId}
                ticket={selected}
                allTickets={tickets}
                onClose={() => setSelectedId(null)}
                onChanged={(s) => setState(s)}
              />
            )
          }
        >
            <svg width={layout.width} height={layout.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
              {layout.edges.map((e) => (
                <path key={`${e.from}-${e.to}`} d={e.d} fill="none" stroke="var(--border2)" strokeWidth={1.5} strokeDasharray="5 5" />
              ))}
            </svg>
            {layout.nodes.map((n) => {
              const t = tickets.find((x) => x.id === n.id)!;
              const sel = selectedId === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
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
                    borderLeft: '3px solid var(--accent)',
                    borderRadius: 11,
                    padding: '12px 13px 10px',
                    boxShadow: sel ? '0 8px 24px -6px var(--shadow)' : '0 1px 2px var(--shadow)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6, flex: 'none' }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                      #{t.id}
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
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 'auto', flex: 'none' }}>
                    {t.dependsOn.length ? `${t.dependsOn.length} upstream` : 'root ticket'}
                  </div>
                </button>
              );
            })}
        </GraphViewport>
      </div>
      {approveOpen && (
        <ApproveModal
          projectId={projectId}
          currentVersion={state.currentVersion}
          onClose={() => setApproveOpen(false)}
          onApproved={(result) => {
            setApproveOpen(false);
            onApproved(result);
          }}
        />
      )}
    </div>
  );
}

function ChatBubble({ role, content }: { role: string; content: string }) {
  if (role === 'tool') {
    return (
      <div
        className="mono"
        style={{
          fontSize: 11.5,
          color: 'var(--ink2)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 7,
          padding: '6px 10px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          alignSelf: 'flex-start',
        }}
      >
        <span style={{ color: 'var(--accent)' }}>tool</span>
        {content}
      </div>
    );
  }
  if (role === 'system') {
    return <div style={{ fontSize: 11.5, color: 'var(--muted)', fontStyle: 'italic' }}>{content}</div>;
  }
  const isUser = role === 'user';
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '88%',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--ink)',
        background: isUser ? 'var(--accent-soft)' : 'var(--panel2)',
        border: '1px solid var(--border)',
        borderRadius: 11,
        padding: '9px 12px',
        whiteSpace: 'pre-wrap',
      }}
    >
      {content}
    </div>
  );
}

function TicketInspector({
  projectId,
  ticket,
  allTickets,
  onClose,
  onChanged,
}: {
  projectId: string;
  ticket: DraftTicket;
  allTickets: DraftTicket[];
  onClose: () => void;
  onChanged: (s: ProjectState) => void;
}) {
  const [title, setTitle] = useState(ticket.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runMutation(fn: () => Promise<ProjectState>, onSuccess?: () => void) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
      onSuccess?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function commitTitle() {
    if (title.trim() === ticket.title) return;
    runMutation(() => api.editTicket(projectId, ticket.id, { title: title.trim() }));
  }

  function removeAC(text: string) {
    runMutation(() =>
      api.editTicket(projectId, ticket.id, { acceptanceCriteria: ticket.acceptanceCriteria.filter((a) => a !== text) })
    );
  }

  function removeDep(depId: string) {
    runMutation(() => api.removeDependency(projectId, ticket.id, depId));
  }

  function addDep(depId: string) {
    runMutation(() => api.addDependency(projectId, ticket.id, depId));
  }

  function handleDelete() {
    runMutation(() => api.deleteTicket(projectId, ticket.id), onClose);
  }

  const addable = allTickets.filter((t) => t.id !== ticket.id && !ticket.dependsOn.includes(t.id));

  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        bottom: 14,
        width: 336,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: '0 16px 44px -16px var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        opacity: busy ? 0.7 : 1,
      }}
    >
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', paddingTop: 5 }}>
          #{ticket.id}
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          className="serif"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}
        />
        <button onClick={onClose} style={{ color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: 2 }}>
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <Label>Problem</Label>
        <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5, marginBottom: 18 }}>{ticket.problem}</div>

        <Label>Acceptance criteria</Label>
        {ticket.acceptanceCriteria.map((a) => (
          <div key={a} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
            <span style={{ width: 15, height: 15, borderRadius: 4, border: '1.5px solid var(--border2)', flex: 'none', marginTop: 2 }} />
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.45 }}>{a}</span>
            <button onClick={() => removeAC(a)} style={{ color: 'var(--muted)', fontSize: 13, padding: '0 2px' }}>
              ×
            </button>
          </div>
        ))}

        <div style={{ margin: '18px 0 8px' }}>
          <Label>Depends on</Label>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {ticket.dependsOn.map((d) => {
            const dep = allTickets.find((t) => t.id === d);
            return (
              <span
                key={d}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  background: 'var(--accent-soft)',
                  color: 'var(--ink)',
                  border: '1px solid var(--border)',
                  borderRadius: 7,
                  padding: '4px 6px 4px 9px',
                }}
              >
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent)' }}>
                  #{d}
                </span>
                {dep?.title ?? d}
                <button onClick={() => removeDep(d)} style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 2 }}>
                  ×
                </button>
              </span>
            );
          })}
          {ticket.dependsOn.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: '4px 0' }}>Root ticket — no upstream</span>
          )}
        </div>
        {addable.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {addable.map((d) => (
              <button
                key={d.id}
                onClick={() => addDep(d.id)}
                style={{ fontSize: 12, color: 'var(--ink2)', border: '1px dashed var(--border2)', borderRadius: 7, padding: '4px 9px' }}
              >
                + #{d.id} {d.title}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div style={{ padding: '0 16px 12px', color: 'oklch(0.57 0.14 28)', fontSize: 12 }}>{error}</div>
      )}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <button
          onClick={handleDelete}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: 'oklch(0.57 0.14 28)',
            background: 'oklch(0.92 0.05 28 / .5)',
            border: '1px solid oklch(0.8 0.08 28 / .4)',
            borderRadius: 8,
            padding: '9px 14px',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
      {children}
    </div>
  );
}
