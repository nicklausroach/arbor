from __future__ import annotations

import json
import threading
from http.server import HTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from arbor.drafting import DraftStore
from arbor.repo import connect_repository
from arbor.ui import make_handler
from tests.test_drafting import graph_draft, init_repo


def create_project(tmp_path: Path) -> tuple[DraftStore, int]:
    repo = tmp_path / "repo"
    repo.mkdir()
    init_repo(repo)
    store = DraftStore(tmp_path / "arbor.sqlite")
    project = store.create_project("Repo context", "Objective", connect_repository(repo))
    store.save_revision(project.id, graph_draft(), "initial")
    return store, project.id


def with_server(db_path: Path, project_id: int) -> tuple[str, HTTPServer]:
    server = HTTPServer(("127.0.0.1", 0), make_handler(db_path, project_id))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    return f"http://{host}:{port}", server


def get_json(url: str) -> dict:
    with urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def get_text(url: str) -> str:
    with urlopen(url, timeout=5) as response:
        return response.read().decode("utf-8")


def post_json(url: str, payload: dict) -> dict:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def test_home_page_uses_d3_chat_not_json_edit_form(tmp_path: Path) -> None:
    store, project_id = create_project(tmp_path)
    base_url, server = with_server(store.db_path, project_id)
    try:
        html = get_text(f"{base_url}/")
    finally:
        server.shutdown()

    assert "d3@7" in html
    assert "chat-form" in html
    assert "Payload JSON" not in html
    assert "/api/edit" not in html


def test_graph_endpoint_returns_latest_nodes_and_edges(tmp_path: Path) -> None:
    store, project_id = create_project(tmp_path)
    base_url, server = with_server(store.db_path, project_id)
    try:
        graph = get_json(f"{base_url}/api/graph")
    finally:
        server.shutdown()

    assert {node["id"] for node in graph["nodes"]} == {"repo-context", "draft", "review"}
    assert {edge["source"] for edge in graph["edges"]} == {"repo-context", "draft"}


def test_chat_endpoint_renames_ticket_and_creates_version(tmp_path: Path) -> None:
    store, project_id = create_project(tmp_path)
    base_url, server = with_server(store.db_path, project_id)
    try:
        response = post_json(f"{base_url}/api/chat", {"message": "rename draft to Draft repo tickets"})
    finally:
        server.shutdown()

    assert response["version_id"] == 2
    assert response["reply"] == "Renamed draft."
    assert any(node["title"] == "Draft repo tickets" for node in response["graph"]["nodes"])


def test_invalid_chat_edit_returns_400_without_version(tmp_path: Path) -> None:
    store, project_id = create_project(tmp_path)
    base_url, server = with_server(store.db_path, project_id)
    try:
        request = Request(
            f"{base_url}/api/chat",
            data=json.dumps({"message": "make repo-context depend on review"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urlopen(request, timeout=5)
        except HTTPError as exc:
            body = json.loads(exc.read().decode("utf-8"))
            assert exc.code == 400
            assert "dependency cycle" in body["error"]
        else:
            raise AssertionError("invalid edit accepted")
    finally:
        server.shutdown()

    assert store.latest_version(project_id).id == 1
