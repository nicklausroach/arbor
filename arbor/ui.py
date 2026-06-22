from __future__ import annotations

import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .drafting import DraftStore, GraphRevisionError, ProjectDraft, render_ticket_graph


HTML = """<!doctype html>
<meta charset="utf-8">
<title>Arbor draft DAG</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; background: #fafafa; color: #1f2937; }
#graph { display: flex; gap: 2rem; align-items: flex-start; margin: 1rem 0; }
.layer { min-width: 14rem; display: grid; gap: 1rem; }
.node { border: 1px solid #d1d5db; border-radius: .75rem; padding: 1rem; background: white; box-shadow: 0 1px 2px #0001; }
.node.root { border-color: #16a34a; }
.node.blocked { border-color: #f97316; }
.node.ready { border-color: #2563eb; }
.node small { color: #6b7280; }
textarea, input { width: 100%; box-sizing: border-box; margin: .25rem 0; }
button { margin-top: .25rem; }
#error { color: #b91c1c; white-space: pre-wrap; }
.edge { color: #6b7280; font-size: .875rem; }
</style>
<h1>Arbor draft DAG</h1>
<p id="error"></p>
<div id="graph"></div>
<h2>Direct edit</h2>
<form id="edit-form">
  <label>Operation <input name="operation" value="rename"></label>
  <label>Payload JSON <textarea name="payload" rows="6">{"id":"draft","title":"Draft repo tickets"}</textarea></label>
  <button>Apply edit</button>
</form>
<h2>Chat revision JSON</h2>
<form id="llm-form">
  <label>Planner output JSON <textarea name="raw" rows="8"></textarea></label>
  <button>Apply revision</button>
</form>
<script>
async function loadGraph() {
  const response = await fetch('/api/graph');
  const graph = await response.json();
  const byLayer = new Map();
  for (const node of graph.nodes) {
    const list = byLayer.get(node.layer) || [];
    list.push(node);
    byLayer.set(node.layer, list);
  }
  const graphEl = document.getElementById('graph');
  graphEl.innerHTML = '';
  for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
    const column = document.createElement('div');
    column.className = 'layer';
    for (const node of byLayer.get(layer)) {
      const card = document.createElement('div');
      card.className = `node ${node.status}`;
      const deps = graph.edges.filter(edge => edge.target === node.id).map(edge => edge.source).join(', ') || 'project objective';
      card.innerHTML = `<strong>${node.title}</strong><br><small>${node.id}</small><div class="edge">depends on: ${deps}</div>`;
      column.appendChild(card);
    }
    graphEl.appendChild(column);
  }
}
async function postJson(path, payload) {
  const error = document.getElementById('error');
  error.textContent = '';
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
  const body = await response.json();
  if (!response.ok) {
    error.textContent = body.error;
    return;
  }
  await loadGraph();
}
document.getElementById('edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  let payload;
  try {
    payload = JSON.parse(form.get('payload'));
  } catch (error) {
    document.getElementById('error').textContent = error.message;
    return;
  }
  await postJson('/api/edit', {operation: form.get('operation'), payload});
});
document.getElementById('llm-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  await postJson('/api/llm-revision', {raw_output: form.get('raw')});
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
            if path == "/api/edit":
                self._handle_edit()
                return
            if path == "/api/llm-revision":
                self._handle_llm_revision()
                return
            self._send_json({"error": "not found"}, status=404)

        def log_message(self, format: str, *args: Any) -> None:
            return

        def _handle_edit(self) -> None:
            try:
                request = self._read_json()
                operation = request.get("operation")
                payload = request.get("payload", {})
                if not isinstance(operation, str) or not isinstance(payload, dict):
                    raise GraphRevisionError("operation and payload are required")
                store = DraftStore(db_path)
                version = store.apply_edit(project_id, operation, payload)
            except (ValueError, json.JSONDecodeError) as exc:
                self._send_json({"error": str(exc)}, status=400)
                return
            self._send_json({"version_id": version.id, "graph": _graph_payload(ProjectDraft(version.summary, version.tickets))})

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


def serve(db_path: Path, project_id: int, host: str = "127.0.0.1", port: int = 8765) -> None:
    server = HTTPServer((host, port), make_handler(db_path, project_id))
    print(f"Serving Arbor draft UI at http://{host}:{server.server_port}")
    server.serve_forever()


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
