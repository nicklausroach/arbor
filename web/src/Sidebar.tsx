import { useState } from 'react';
import type { Project, Repository } from './api';

interface Props {
  repos: Repository[];
  currentRepoId: string | null;
  projects: Project[];
  currentProjectId: string | null;
  onSelectRepo: (id: string) => void;
  onConnectAnother: () => void;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onDeleteProject: (id: string) => void;
  onOpenSettings: () => void;
}

const PALETTE = ['oklch(0.52 0.09 150)', 'oklch(0.58 0.1 60)', 'oklch(0.55 0.1 300)', 'oklch(0.55 0.1 245)', 'oklch(0.57 0.12 28)'];

function colorFor(key: string): string {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) % PALETTE.length;
  return PALETTE[Math.abs(hash)];
}

function initialsFor(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

const STATUS_META: Record<string, { label: string; dot: string }> = {
  draft: { label: 'Draft', dot: 'var(--muted)' },
  approval_failed: { label: 'Approval failed', dot: 'oklch(0.57 0.14 28)' },
  approved: { label: 'Approved', dot: 'var(--muted)' },
  running: { label: 'Running', dot: 'oklch(0.55 0.1 245)' },
  done: { label: 'Done', dot: 'oklch(0.5 0.09 150)' },
};

export function Sidebar({
  repos,
  currentRepoId,
  projects,
  currentProjectId,
  onSelectRepo,
  onConnectAnother,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  onOpenSettings,
}: Props) {
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const currentRepo = repos.find((r) => r.id === currentRepoId) ?? repos[0] ?? null;

  return (
    <nav
      style={{
        width: 212,
        flex: 'none',
        background: 'var(--panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 6px 18px' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round">
          <line x1="12" y1="22" x2="12" y2="13" />
          <line x1="12" y1="15" x2="6" y2="9" />
          <line x1="12" y1="13" x2="18" y2="7" />
          <circle cx="6" cy="8" r="2.4" fill="var(--accent)" stroke="none" />
          <circle cx="18" cy="6" r="2.4" fill="var(--accent)" stroke="none" />
          <circle cx="12" cy="12" r="2.4" fill="var(--accent)" stroke="none" />
        </svg>
        <span className="serif" style={{ fontSize: 21, fontWeight: 600, color: 'var(--ink)' }}>
          Arbor
        </span>
      </div>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <button
          onClick={() => setRepoMenuOpen((v) => !v)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '8px 9px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          {currentRepo ? (
            <>
              <span
                className="mono"
                style={{
                  width: 27,
                  height: 27,
                  borderRadius: 7,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#fff',
                  background: colorFor(currentRepo.id),
                }}
              >
                {initialsFor(currentRepo.name)}
              </span>
              <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {currentRepo.owner}/{currentRepo.name}
                </span>
                <span className="mono" style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>
                  {currentRepo.default_branch}
                </span>
              </span>
            </>
          ) : (
            <span style={{ flex: 1, textAlign: 'left', fontSize: 12.5, color: 'var(--muted)' }}>No repo connected</span>
          )}
          <span style={{ color: 'var(--muted)', fontSize: 12, transform: 'translateY(-1px)' }}>⌄</span>
        </button>
        {repoMenuOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setRepoMenuOpen(false)} />
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                right: 0,
                zIndex: 30,
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                boxShadow: '0 16px 40px -12px var(--shadow)',
                padding: 6,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--muted)', padding: '7px 8px 5px' }}>
                Repositories
              </div>
              {repos.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onSelectRepo(r.id);
                    setRepoMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: 8,
                    borderRadius: 8,
                    background: r.id === currentRepoId ? 'var(--panel2)' : 'transparent',
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      width: 25,
                      height: 25,
                      borderRadius: 6,
                      flex: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 600,
                      color: '#fff',
                      background: colorFor(r.id),
                    }}
                  >
                    {initialsFor(r.name)}
                  </span>
                  <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.owner}/{r.name}
                    </span>
                  </span>
                  {r.id === currentRepoId && <span style={{ color: 'var(--accent)', fontSize: 13 }}>✓</span>}
                </button>
              ))}
              <button
                onClick={() => {
                  onConnectAnother();
                  setRepoMenuOpen(false);
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '9px 8px',
                  marginTop: 4,
                  borderTop: '1px solid var(--border)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--accent)',
                }}
              >
                <span style={{ width: 25, textAlign: 'center', fontSize: 15 }}>+</span>Connect another repo
              </button>
            </div>
          </>
        )}
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', padding: '0 6px 8px' }}>
        Projects
      </div>
      {projects.map((p) => {
        const active = p.id === currentProjectId;
        const meta = STATUS_META[p.status] ?? STATUS_META.draft;
        const isHovered = hoveredProjectId === p.id;
        return (
          <div
            key={p.id}
            onMouseEnter={() => setHoveredProjectId(p.id)}
            onMouseLeave={() => setHoveredProjectId(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 2,
            }}
          >
            <button
              onClick={() => onSelectProject(p.id)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '8px 10px',
                borderRadius: 9,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--ink)' : 'var(--ink2)',
                background: active ? 'var(--panel2)' : 'transparent',
                minWidth: 0,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 99, flex: 'none', background: meta.dot }} />
              <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{p.title}</span>
              {!isHovered && <span style={{ fontSize: 10, color: 'var(--muted)', flex: 'none', whiteSpace: 'nowrap' }}>{meta.label}</span>}
            </button>
            {isHovered && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteProject(p.id);
                }}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  fontWeight: 400,
                  color: 'oklch(0.57 0.14 28)',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                title="Delete project"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onNewProject}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '8px 10px',
          marginTop: 5,
          borderRadius: 9,
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--ink2)',
          border: '1px dashed var(--border2)',
        }}
      >
        <span style={{ width: 16, textAlign: 'center', fontSize: 14 }}>+</span>New project
      </button>

      <div style={{ flex: 1 }} />
      <button
        onClick={onOpenSettings}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, fontSize: 13.5, color: 'var(--ink2)' }}
      >
        <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center' }}>⚙</span> Settings
      </button>
    </nav>
  );
}
