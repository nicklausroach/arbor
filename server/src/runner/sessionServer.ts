import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { getRun, getTicketById } from "../projects/store.js";
import { worktreePath } from "./paths.js";
import { endSession, spawnSession } from "./sessionPty.js";

const RUN_SESSION_RE = /^\/ws\/runs\/([^/]+)\/session$/;

export function attachSessionServer(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws, req) => {
    const match = RUN_SESSION_RE.exec(req.url ?? "");
    const runId = match?.[1];
    const run = runId ? getRun(runId) : undefined;
    const ticket = run ? getTicketById(run.ticket_id) : undefined;

    if (!run || !ticket || !run.session_id) {
      ws.send(JSON.stringify({ type: "output", data: "No resumable session for this run.\r\n" }));
      ws.close();
      return;
    }

    const cwd = worktreePath(ticket.project_id, ticket.id);
    let term;
    try {
      term = spawnSession(run.id, cwd, run.session_id);
    } catch (err) {
      ws.send(JSON.stringify({ type: "output", data: `Failed to start session: ${(err as Error).message}\r\n` }));
      ws.close();
      return;
    }

    const onData = term.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "output", data }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; data?: string; cols?: number; rows?: number };
        if (msg.type === "input" && typeof msg.data === "string") term.write(msg.data);
        else if (msg.type === "resize" && msg.cols && msg.rows) term.resize(msg.cols, msg.rows);
      } catch {
        // ignore malformed message
      }
    });

    ws.on("close", () => {
      onData.dispose();
      endSession(run.id);
    });
  });
}
