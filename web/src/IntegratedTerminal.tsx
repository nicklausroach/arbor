import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

interface Props {
  runId: string;
  ticketNumber: number;
  branch: string;
  onClose: () => void;
}

export function IntegratedTerminal({ runId, ticketNumber, branch, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      convertEol: true,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12.5,
      theme: { background: '#14110d', foreground: '#e8e2d6' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.writeln('connecting to agent session…');

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/runs/${runId}/session`);

    ws.onopen = () => {
      term.writeln('connected.');
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as { type: string; data?: string };
      if (msg.type === 'output' && msg.data) term.write(msg.data);
    };
    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
      term.writeln(`\r\n[connection error: ${event.type}]`);
    };
    ws.onclose = () => term.writeln('\r\n[session closed]');

    const onData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });

    const handleResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      onData.dispose();
      ws.close();
      term.dispose();
    };
  }, [runId]);

  return (
    <div
      style={{
        flex: 'none',
        height: 300,
        display: 'flex',
        flexDirection: 'column',
        background: '#14110d',
        borderTop: '1px solid var(--border)',
        boxShadow: '0 -10px 30px -16px rgba(0,0,0,.5)',
      }}
    >
      <div
        style={{
          height: 36,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 8px 0 14px',
          background: 'rgba(255,255,255,.045)',
          borderBottom: '1px solid rgba(255,255,255,.07)',
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 99, background: '#62C554', animation: 'ar-pulse 1.3s infinite' }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,.84)' }}>agent session</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.42)' }}>#{ticketNumber}</span>
        <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,.12)' }} />
        <span
          className="mono"
          style={{ fontSize: 11, color: 'rgba(255,255,255,.36)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 340 }}
        >
          {branch}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,.3)' }}>attached · stdin live</span>
        <button
          onClick={onClose}
          title="Close terminal"
          style={{
            width: 26,
            height: 24,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,.55)',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', padding: '8px 10px' }} />
    </div>
  );
}
