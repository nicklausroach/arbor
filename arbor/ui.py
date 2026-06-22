from __future__ import annotations

import json
import re
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .drafting import DraftStore, GraphRevisionError, ProjectDraft, render_ticket_graph


HTML = """<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arbor draft DAG</title>
<style>
:root { color-scheme: light; --ink:#111827; --muted:#6b7280; --line:#cbd5e1; --panel:#ffffff; --bg:#f8fafc; --blue:#2563eb; --green:#16a34a; --orange:#f97316; --red:#dc2626; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, #eef2ff, transparent 32rem), var(--bg); color: var(--ink); }
main { max-width: 1180px; margin: 0 auto; padding: 2rem; }
header { display:flex; justify-content:space-between; gap:1rem; align-items:flex-end; margin-bottom:1.25rem; }
h1 { font-size: clamp(1.8rem, 4vw, 3rem); margin:0; letter-spacing:-.04em; }
.subtle { color: var(--muted); margin:.35rem 0 0; }
.shell { display:grid; grid-template-columns: minmax(0, 1fr) 22rem; gap:1rem; align-items:stretch; }
.card { background: color-mix(in srgb, var(--panel) 92%, transparent); border:1px solid #e5e7eb; border-radius:1.25rem; box-shadow:0 18px 40px #0f172a14; overflow:hidden; }
.graph-card { min-height: 620px; position:relative; }
#graph { width:100%; height:620px; display:block; }
.node rect { stroke-width:2; filter: drop-shadow(0 8px 14px #0f172a22); }
.node text { font-size:13px; fill:var(--ink); pointer-events:none; }
.node .id { fill:var(--muted); font-size:11px; }
.link { stroke:var(--line); stroke-width:2.2; fill:none; marker-end:url(#arrow); }
.legend { position:absolute; left:1rem; top:1rem; display:flex; gap:.5rem; flex-wrap:wrap; }
.pill { background:white; border:1px solid #e5e7eb; border-radius:999px; padding:.35rem .6rem; font-size:.78rem; color:var(--muted); }
.chat { display:flex; flex-direction:column; min-height:620px; }
.chat-log { flex:1; padding:1rem; overflow:auto; display:flex; flex-direction:column; gap:.65rem; }
.msg { padding:.7rem .8rem; border-radius:1rem; line-height:1.35; font-size:.92rem; }
.msg.user { margin-left:1.75rem; background:#dbeafe; }
.msg.bot { margin-right:1.75rem; background:#f1f5f9; }
.msg.error { background:#fee2e2; color:#991b1b; }
.chat form { border-top:1px solid #e5e7eb; padding:1rem; display:grid; gap:.65rem; }
textarea { width:100%; min-height:5rem; resize:vertical; border:1px solid #d1d5db; border-radius:.85rem; padding:.75rem; font:inherit; }
button { border:0; border-radius:.85rem; padding:.75rem 1rem; font-weight:700; color:white; background:linear-gradient(135deg, #2563eb, #7c3aed); cursor:pointer; }
.examples { color:var(--muted); font-size:.8rem; line-height:1.45; }
#error { color: var(--red); min-height:1.25rem; }
@media (max-width: 900px) { .shell { grid-template-columns:1fr; } }
</style>
<main>
  <header>
    <div>
      <h1>Draft ticket DAG</h1>
      <p class="subtle">Left-to-right dependencies. Valid chat revisions become immutable versions.</p>
    </div>
    <p id="error"></p>
  </header>
  <section class="shell">
    <div class="card graph-card">
      <div class="legend"><span class="pill">green root</span><span class="pill">orange blocked</span><span class="pill">drag nodes</span></div>
      <svg id="graph" aria-label="Ticket dependency graph"></svg>
    </div>
    <aside class="card chat">
      <div id="chat-log" class="chat-log">
        <div class="msg bot">Tell Arbor how to revise the draft. Try “rename draft to Draft repo tickets” or “make repo-context depend on review”.</div>
      </div>
      <form id="chat-form">
        <textarea name="message" placeholder="Rename, add/remove dependencies, delete tickets…"></textarea>
        <button>Send revision</button>
        <div class="examples">Commands: rename ID to Title; make ID depend on DEP; remove dependency DEP from ID; delete ID.</div>
      </form>
    </aside>
  </section>
</main>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script>
const svg = document.getElementById('graph');
const log = document.getElementById('chat-log');
function say(text, cls='bot') {
  const node = document.createElement('div');
  node.className = `msg ${cls}`;
  node.textContent = text;
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
}
async function loadGraph() {
  const response = await fetch('/api/graph');
  const graph = await response.json();
  renderGraph(graph);
}
function svgEl(name, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function renderGraph(graph) {
  const width = svg.clientWidth || 760;
  const height = svg.clientHeight || 620;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const defs = svgEl('defs');
  const marker = svgEl('marker', {id:'arrow', viewBox:'0 -5 10 10', refX:'118', refY:'0', markerWidth:'7', markerHeight:'7', orient:'auto'});
  marker.appendChild(svgEl('path', {d:'M0,-5L10,0L0,5', fill:'#94a3b8'}));
  defs.appendChild(marker);
  svg.appendChild(defs);
  const layers = new Map();
  for (const node of graph.nodes) layers.set(node.layer, (layers.get(node.layer) || 0) + 1);
  const maxLayer = Math.max(0, ...graph.nodes.map(node => node.layer));
  const counts = new Map();
  const nodes = graph.nodes.map(node => {
    const index = counts.get(node.layer) || 0;
    counts.set(node.layer, index + 1);
    const count = layers.get(node.layer) || 1;
    return {...node, x: 90 + node.layer * ((width - 180) / Math.max(1, maxLayer)), y: (height / (count + 1)) * (index + 1)};
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    svg.appendChild(svgEl('path', {
      class: 'link',
      d: `M${source.x + 110},${source.y} C${(source.x + target.x)/2},${source.y} ${(source.x + target.x)/2},${target.y} ${target.x - 110},${target.y}`
    }));
  }
  for (const node of nodes) {
    const group = svgEl('g', {class:'node', transform:`translate(${node.x - 110},${node.y - 34})`});
    group.appendChild(svgEl('rect', {width:'220', height:'68', rx:'16', fill:'#fff', stroke: node.status === 'root' ? '#16a34a' : '#f97316'}));
    const title = svgEl('text', {x:'14', y:'28'});
    title.textContent = node.title.length > 27 ? `${node.title.slice(0, 24)}…` : node.title;
    group.appendChild(title);
    const id = svgEl('text', {class:'id', x:'14', y:'49'});
    id.textContent = node.id;
    group.appendChild(id);
    svg.appendChild(group);
  }
}
async function postChat(message) {
  say(message, 'user');
  const response = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message})});
  const body = await response.json();
  if (!response.ok) {
    say(body.error, 'error');
    return;
  }
  say(body.reply || 'Updated draft.');
  renderGraph(body.graph);
}
document.getElementById('chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  const message = String(form.get('message') || '').trim();
  if (!message) return;
  form.set('message', '');
  event.target.reset();
  await postChat(message);
});
loadGraph();
</script>
"""


def make_handler(db_path: Path, project_id: int) -> type[BaseHTTPRequestHandler]:
    class ArborHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/":
                self._send(200, HTML.encode("utf-8"), "text/html; charset=utf-8")
                return
            if path == "/api/graph":
                store = DraftStore(db_path)
                version = store.latest_version(project_id)
                self._send_json(_version_payload(version.summary, ProjectDraft(version.summary, version.tickets)))
                return
            self._send_json({"error": "not found"}, status=404)

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/chat":
                self._handle_chat()
                return
            if path == "/api/llm-revision":
                self._handle_llm_revision()
                return
            self._send_json({"error": "not found"}, status=404)

        def log_message(self, format: str, *args: Any) -> None:
            return

        def _handle_chat(self) -> None:
            try:
                request = self._read_json()
                message = request.get("message")
                if not isinstance(message, str) or not message.strip():
                    raise GraphRevisionError("message is required")
                operation, payload, reply = _parse_chat(message)
                store = DraftStore(db_path)
                version = store.apply_edit(project_id, operation, payload)
            except (ValueError, json.JSONDecodeError) as exc:
                self._send_json({"error": str(exc)}, status=400)
                return
            self._send_json({"version_id": version.id, "reply": reply, "graph": _graph_payload(ProjectDraft(version.summary, version.tickets))})

        def _handle_llm_revision(self) -> None:
            try:
                request = self._read_json()
                raw_output = request.get("raw_output")
                if not isinstance(raw_output, str):
                    raise GraphRevisionError("raw_output is required")
                store = DraftStore(db_path)
                result = store.apply_llm_revision(project_id, raw_output)
            except (ValueError, json.JSONDecodeError) as exc:
                self._send_json({"error": str(exc)}, status=400)
                return
            if result.version is None:
                self._send_json({"error": result.error, "repair_draft": _draft_payload(result.repair_draft)}, status=400)
                return
            self._send_json({"version_id": result.version.id, "graph": _graph_payload(ProjectDraft(result.version.summary, result.version.tickets))})

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8")
            data = json.loads(body or "{}")
            if not isinstance(data, dict):
                raise GraphRevisionError("JSON body must be an object")
            return data

        def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
            self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return ArborHandler


def make_server(db_path: Path, project_id: int, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(db_path, project_id))


def serve(db_path: Path, project_id: int, host: str = "127.0.0.1", port: int = 8765) -> None:
    server = make_server(db_path, project_id, host, port)
    print(f"Serving Arbor draft UI at http://{host}:{server.server_port}")
    server.serve_forever()


def _parse_chat(message: str) -> tuple[str, dict[str, Any], str]:
    text = " ".join(message.strip().split())
    if match := re.fullmatch(r"rename ([a-zA-Z0-9_-]+) to (.+)", text, re.IGNORECASE):
        ticket_id, title = match.groups()
        return "rename", {"id": ticket_id, "title": title}, f"Renamed {ticket_id}."
    if match := re.fullmatch(r"(?:make|add) ([a-zA-Z0-9_-]+) depend(?:s)? on ([a-zA-Z0-9_-]+)", text, re.IGNORECASE):
        ticket_id, dependency = match.groups()
        return "add_dependency", {"id": ticket_id, "dependency": dependency}, f"Added dependency {dependency} to {ticket_id}."
    if match := re.fullmatch(r"remove dependency ([a-zA-Z0-9_-]+) from ([a-zA-Z0-9_-]+)", text, re.IGNORECASE):
        dependency, ticket_id = match.groups()
        return "remove_dependency", {"id": ticket_id, "dependency": dependency}, f"Removed dependency {dependency} from {ticket_id}."
    if match := re.fullmatch(r"delete ([a-zA-Z0-9_-]+)", text, re.IGNORECASE):
        ticket_id = match.group(1)
        return "delete", {"id": ticket_id}, f"Deleted {ticket_id}."
    if match := re.fullmatch(r"change body of ([a-zA-Z0-9_-]+) to (.+)", text, re.IGNORECASE):
        ticket_id, problem = match.groups()
        return "edit_body", {"id": ticket_id, "problem": problem}, f"Updated body for {ticket_id}."
    if match := re.fullmatch(r"set acceptance criteria of ([a-zA-Z0-9_-]+) to (.+)", text, re.IGNORECASE):
        ticket_id, criteria = match.groups()
        return "edit_acceptance_criteria", {"id": ticket_id, "acceptanceCriteria": [item.strip() for item in criteria.split(";") if item.strip()]}, f"Updated acceptance criteria for {ticket_id}."
    raise GraphRevisionError("I can handle: rename ID to Title; make ID depend on DEP; remove dependency DEP from ID; delete ID; change body of ID to Text; set acceptance criteria of ID to A; B")


def _version_payload(summary: str, draft: ProjectDraft) -> dict[str, Any]:
    return {"summary": summary, **_graph_payload(draft)}


def _graph_payload(draft: ProjectDraft) -> dict[str, Any]:
    graph = render_ticket_graph(draft)
    return {
        "nodes": [asdict(node) for node in graph.nodes],
        "edges": [asdict(edge) for edge in graph.edges],
    }


def _draft_payload(draft: ProjectDraft) -> dict[str, Any]:
    return {
        "summary": draft.summary,
        "tickets": [
            {
                "id": ticket.id,
                "title": ticket.title,
                "problem": ticket.problem,
                "acceptanceCriteria": ticket.acceptance_criteria,
                "implementationNotes": ticket.implementation_notes,
                "dependsOn": ticket.depends_on,
            }
            for ticket in draft.tickets
        ],
    }
