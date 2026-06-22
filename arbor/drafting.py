from __future__ import annotations

import json
import re
import sqlite3
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .repo import RepositoryMetadata


class GraphRevisionError(ValueError):
    pass


@dataclass(frozen=True)
class DraftTicket:
    id: str
    title: str
    problem: str
    acceptance_criteria: list[str]
    implementation_notes: str | None = None
    depends_on: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ProjectDraft:
    summary: str
    tickets: list[DraftTicket]


@dataclass(frozen=True)
class Project:
    id: int
    title: str
    objective: str
    repository: RepositoryMetadata


@dataclass(frozen=True)
class DraftVersion:
    id: int
    project_id: int
    summary: str
    raw_output: str
    tickets: list[DraftTicket]


@dataclass(frozen=True)
class GraphNode:
    id: str
    title: str
    status: str
    layer: int


@dataclass(frozen=True)
class GraphEdge:
    source: str
    target: str


@dataclass(frozen=True)
class TicketGraph:
    nodes: list[GraphNode]
    edges: list[GraphEdge]


@dataclass(frozen=True)
class RevisionResult:
    version: DraftVersion | None
    error: str
    repair_draft: ProjectDraft


class PlannerContext:
    def __init__(self, repo: Path | str, pinned_paths: tuple[Path, ...] = ()) -> None:
        self.repo = Path(repo).expanduser().resolve()
        self.pinned_paths = tuple(Path(path) for path in pinned_paths)
        if not self.repo.exists():
            raise ValueError(f"repo does not exist: {self.repo}")

    def tree(self) -> str:
        return "\n".join(self._visible_files())

    def read_file(self, path: str | Path) -> str:
        relative = self._safe_relative(path)
        if relative.as_posix() not in self._visible_files():
            raise ValueError(f"path outside pinned planning context: {relative}")
        return self._read_visible_file(relative).read_text(encoding="utf-8")

    def search(self, pattern: str) -> dict[str, list[str]]:
        regex = re.compile(pattern)
        matches: dict[str, list[str]] = {}
        for name in self._visible_files():
            lines = []
            for line in self._read_visible_file(Path(name)).read_text(encoding="utf-8").splitlines():
                if regex.search(line):
                    lines.append(line)
            if lines:
                matches[name] = lines
        return matches

    def _visible_files(self) -> list[str]:
        tracked = _tracked_files(self.repo)
        if not self.pinned_paths:
            return tracked
        visible: set[str] = set()
        for pin in self.pinned_paths:
            relative = self._safe_relative(pin)
            prefix = relative.as_posix().rstrip("/")
            visible.update(path for path in tracked if path == prefix or path.startswith(f"{prefix}/"))
        return sorted(visible)

    def _read_visible_file(self, relative: Path) -> Path:
        path = (self.repo / relative).resolve()
        try:
            path.relative_to(self.repo)
        except ValueError as exc:
            raise ValueError(f"path escapes repository: {relative}") from exc
        return path

    def _safe_relative(self, path: str | Path) -> Path:
        candidate = Path(path)
        if candidate.is_absolute():
            try:
                return candidate.resolve().relative_to(self.repo)
            except ValueError as exc:
                raise ValueError(f"path outside repository: {path}") from exc
        resolved = candidate
        if ".." in resolved.parts:
            raise ValueError(f"path outside repository: {path}")
        return resolved


class DraftStore:
    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
        self._init_schema()

    def create_project(self, title: str, objective: str, repository: RepositoryMetadata) -> Project:
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO projects (title, objective, local_path, owner, repo_name, default_branch, remote)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    title,
                    objective,
                    str(repository.local_path),
                    repository.owner,
                    repository.name,
                    repository.default_branch,
                    repository.remote,
                ),
            )
        return Project(int(cursor.lastrowid), title, objective, repository)

    def get_project(self, project_id: int) -> Project:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise ValueError(f"unknown project: {project_id}")
        return Project(
            id=int(row["id"]),
            title=str(row["title"]),
            objective=str(row["objective"]),
            repository=RepositoryMetadata(
                local_path=Path(str(row["local_path"])),
                owner=str(row["owner"]),
                name=str(row["repo_name"]),
                default_branch=str(row["default_branch"]),
                remote=str(row["remote"]),
            ),
        )

    def save_planning_output(self, project_id: int, raw_output: str, draft: ProjectDraft) -> DraftVersion:
        tickets = self._stabilize_ticket_ids(project_id, draft.tickets)
        return self._insert_version(project_id, draft.summary, raw_output, tickets)

    def save_revision(self, project_id: int, draft: ProjectDraft, raw_output: str = "direct edit") -> DraftVersion:
        _validate_dependencies(draft)
        return self._insert_version(project_id, draft.summary, raw_output, draft.tickets)

    def latest_version(self, project_id: int) -> DraftVersion:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id FROM draft_versions WHERE project_id = ? ORDER BY id DESC LIMIT 1",
                (project_id,),
            ).fetchone()
        if row is None:
            raise GraphRevisionError(f"project has no draft versions: {project_id}")
        return self._version_by_id(project_id, int(row["id"]))

    def apply_llm_revision(self, project_id: int, raw_output: str) -> RevisionResult:
        previous = self.latest_version(project_id)
        repair = ProjectDraft(previous.summary, previous.tickets)
        try:
            draft = validate_planner_output(raw_output)
            version = self.save_planning_output(project_id, raw_output, draft)
        except ValueError as exc:
            return RevisionResult(None, str(exc), repair)
        return RevisionResult(version, "", ProjectDraft(version.summary, version.tickets))

    def apply_edit(self, project_id: int, operation: str, payload: dict[str, Any]) -> DraftVersion:
        latest = self.latest_version(project_id)
        draft = ProjectDraft(latest.summary, latest.tickets)
        try:
            edited = _apply_edit(draft, operation, payload)
            return self.save_revision(project_id, edited, operation)
        except ValueError as exc:
            raise GraphRevisionError(str(exc)) from exc

    def _insert_version(self, project_id: int, summary: str, raw_output: str, tickets: list[DraftTicket]) -> DraftVersion:
        _validate_dependencies(ProjectDraft(summary, tickets))
        with self._connect() as conn:
            cursor = conn.execute(
                "INSERT INTO draft_versions (project_id, summary, raw_output) VALUES (?, ?, ?)",
                (project_id, summary, raw_output),
            )
            version_id = int(cursor.lastrowid)
            conn.executemany(
                """
                INSERT INTO draft_tickets
                (version_id, ticket_id, title, problem, acceptance_criteria, implementation_notes, depends_on)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        version_id,
                        ticket.id,
                        ticket.title,
                        ticket.problem,
                        json.dumps(ticket.acceptance_criteria),
                        ticket.implementation_notes,
                        json.dumps(ticket.depends_on),
                    )
                    for ticket in tickets
                ],
            )
        return DraftVersion(version_id, project_id, summary, raw_output, tickets)

    def _stabilize_ticket_ids(self, project_id: int, tickets: list[DraftTicket]) -> list[DraftTicket]:
        previous = self._latest_tickets(project_id)
        by_title = {_key(ticket.title): ticket.id for ticket in previous}
        used: set[str] = set()
        stable = []
        for ticket in tickets:
            ticket_id = by_title.get(_key(ticket.title)) or ticket.id or _slug(ticket.title)
            ticket_id = _unique_id(ticket_id, used)
            stable.append(_replace_ticket(ticket, id=ticket_id))
        _validate_dependencies(ProjectDraft("", stable))
        return stable

    def _latest_tickets(self, project_id: int) -> list[DraftTicket]:
        try:
            return self.latest_version(project_id).tickets
        except GraphRevisionError:
            return []

    def _version_by_id(self, project_id: int, version_id: int) -> DraftVersion:
        with self._connect() as conn:
            version = conn.execute(
                "SELECT * FROM draft_versions WHERE id = ? AND project_id = ?",
                (version_id, project_id),
            ).fetchone()
            rows = conn.execute(
                "SELECT * FROM draft_tickets WHERE version_id = ? ORDER BY id",
                (version_id,),
            ).fetchall()
        if version is None:
            raise GraphRevisionError(f"unknown draft version: {version_id}")
        return DraftVersion(
            id=int(version["id"]),
            project_id=project_id,
            summary=str(version["summary"]),
            raw_output=str(version["raw_output"]),
            tickets=[_row_to_ticket(row) for row in rows],
        )

    def _init_schema(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    objective TEXT NOT NULL,
                    local_path TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    repo_name TEXT NOT NULL,
                    default_branch TEXT NOT NULL,
                    remote TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS draft_versions (
                    id INTEGER PRIMARY KEY,
                    project_id INTEGER NOT NULL REFERENCES projects(id),
                    summary TEXT NOT NULL,
                    raw_output TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS draft_tickets (
                    id INTEGER PRIMARY KEY,
                    version_id INTEGER NOT NULL REFERENCES draft_versions(id),
                    ticket_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    problem TEXT NOT NULL,
                    acceptance_criteria TEXT NOT NULL,
                    implementation_notes TEXT,
                    depends_on TEXT NOT NULL
                );
                """
            )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn


def validate_planner_output(raw_output: str) -> ProjectDraft:
    try:
        data = json.loads(raw_output)
    except json.JSONDecodeError as exc:
        raise ValueError(f"planner output is not JSON: {exc.msg}") from exc
    if not isinstance(data, dict):
        raise ValueError("planner output must be an object")
    summary = _required_text(data, "summary")
    items = data.get("tickets")
    if not isinstance(items, list) or not items:
        raise ValueError("planner output must include tickets")
    draft = ProjectDraft(summary=summary, tickets=[_parse_ticket(item) for item in items])
    _validate_dependencies(draft)
    return draft


def render_ticket_graph(draft: ProjectDraft) -> TicketGraph:
    _validate_dependencies(draft)
    by_id = {ticket.id: ticket for ticket in draft.tickets}
    layers: dict[str, int] = {}

    def layer(ticket_id: str) -> int:
        if ticket_id in layers:
            return layers[ticket_id]
        ticket = by_id[ticket_id]
        value = 0 if not ticket.depends_on else 1 + max(layer(dependency) for dependency in ticket.depends_on)
        layers[ticket_id] = value
        return value

    nodes = [
        GraphNode(ticket.id, ticket.title, _status(ticket), layer(ticket.id))
        for ticket in draft.tickets
    ]
    edges = [GraphEdge(dependency, ticket.id) for ticket in draft.tickets for dependency in ticket.depends_on]
    return TicketGraph(nodes, edges)


def _apply_edit(draft: ProjectDraft, operation: str, payload: dict[str, Any]) -> ProjectDraft:
    tickets = list(draft.tickets)
    match operation:
        case "rename":
            ticket_id = _payload_text(payload, "id")
            _require_ticket(tickets, ticket_id)
            title = _payload_text(payload, "title")
            tickets = [_replace_ticket(ticket, title=title) if ticket.id == ticket_id else ticket for ticket in tickets]
        case "edit_body":
            ticket_id = _payload_text(payload, "id")
            _require_ticket(tickets, ticket_id)
            problem = _payload_text(payload, "problem")
            tickets = [_replace_ticket(ticket, problem=problem) if ticket.id == ticket_id else ticket for ticket in tickets]
        case "edit_acceptance_criteria":
            ticket_id = _payload_text(payload, "id")
            _require_ticket(tickets, ticket_id)
            criteria = _payload_texts(payload, "acceptanceCriteria")
            tickets = [_replace_ticket(ticket, acceptance_criteria=criteria) if ticket.id == ticket_id else ticket for ticket in tickets]
        case "add_dependency":
            ticket_id = _payload_text(payload, "id")
            _require_ticket(tickets, ticket_id)
            dependency = _payload_text(payload, "dependency")
            tickets = [
                _replace_ticket(ticket, depends_on=_dedupe([*ticket.depends_on, dependency])) if ticket.id == ticket_id else ticket
                for ticket in tickets
            ]
        case "remove_dependency":
            ticket_id = _payload_text(payload, "id")
            _require_ticket(tickets, ticket_id)
            dependency = _payload_text(payload, "dependency")
            tickets = [
                _replace_ticket(ticket, depends_on=[item for item in ticket.depends_on if item != dependency]) if ticket.id == ticket_id else ticket
                for ticket in tickets
            ]
        case "delete":
            ticket_id = _payload_text(payload, "id")
            _require_ticket(tickets, ticket_id)
            tickets = [
                _replace_ticket(ticket, depends_on=[item for item in ticket.depends_on if item != ticket_id])
                for ticket in tickets
                if ticket.id != ticket_id
            ]
        case "merge":
            tickets = _merge_tickets(tickets, payload)
        case "split":
            tickets = _split_ticket(tickets, payload)
        case _:
            raise ValueError(f"unknown edit operation: {operation}")
    edited = ProjectDraft(draft.summary, tickets)
    _validate_dependencies(edited)
    return edited


def _merge_tickets(tickets: list[DraftTicket], payload: dict[str, Any]) -> list[DraftTicket]:
    ids = set(_payload_texts(payload, "ids"))
    if len(ids) < 2:
        raise ValueError("merge requires at least two tickets")
    selected = [ticket for ticket in tickets if ticket.id in ids]
    if len(selected) != len(ids):
        raise ValueError("merge references unknown ticket")
    used = {ticket.id for ticket in tickets if ticket.id not in ids}
    new_id = _unique_id(str(payload.get("id") or _slug(_payload_text(payload, "title"))), used)
    title = str(payload.get("title") or " / ".join(ticket.title for ticket in selected))
    problem = "\n\n".join(ticket.problem for ticket in selected)
    criteria = _dedupe(text for ticket in selected for text in ticket.acceptance_criteria)
    depends_on = _dedupe(dep for ticket in selected for dep in ticket.depends_on if dep not in ids and dep != new_id)
    merged = DraftTicket(new_id, title, problem, criteria, depends_on=depends_on)
    insert_at = min(index for index, ticket in enumerate(tickets) if ticket.id in ids)
    result: list[DraftTicket] = []
    inserted = False
    for index, ticket in enumerate(tickets):
        if index == insert_at and not inserted:
            result.append(merged)
            inserted = True
        if ticket.id in ids:
            continue
        replaced_deps = [new_id if dep in ids else dep for dep in ticket.depends_on]
        result.append(_replace_ticket(ticket, depends_on=[dep for dep in _dedupe(replaced_deps) if dep != ticket.id]))
    return result


def _split_ticket(tickets: list[DraftTicket], payload: dict[str, Any]) -> list[DraftTicket]:
    original_id = _payload_text(payload, "id")
    original = next((ticket for ticket in tickets if ticket.id == original_id), None)
    if original is None:
        raise ValueError("split references unknown ticket")
    raw_tickets = payload.get("tickets")
    if not isinstance(raw_tickets, list) or len(raw_tickets) < 2:
        raise ValueError("split requires at least two new tickets")
    used = {ticket.id for ticket in tickets if ticket.id != original_id}
    new_tickets: list[DraftTicket] = []
    for item in raw_tickets:
        if not isinstance(item, dict):
            raise ValueError("split ticket must be an object")
        ticket = _parse_ticket({**item, "dependsOn": item.get("dependsOn", original.depends_on)})
        ticket_id = _unique_id(ticket.id or _slug(ticket.title), used)
        used.add(ticket_id)
        new_tickets.append(_replace_ticket(ticket, id=ticket_id))
    by_id = {ticket.id: ticket for ticket in new_tickets}
    for edge in payload.get("order", []):
        if not isinstance(edge, list) or len(edge) != 2 or not all(isinstance(item, str) for item in edge):
            raise ValueError("split order must be [before, after] pairs")
        before, after = edge
        if before not in by_id or after not in by_id:
            raise ValueError("split order references unknown new ticket")
        by_id[after] = _replace_ticket(by_id[after], depends_on=_dedupe([*by_id[after].depends_on, before]))
    new_tickets = [by_id[ticket.id] for ticket in new_tickets]
    last_id = new_tickets[-1].id
    result: list[DraftTicket] = []
    for ticket in tickets:
        if ticket.id == original_id:
            result.extend(new_tickets)
            continue
        result.append(
            _replace_ticket(
                ticket,
                depends_on=[last_id if dep == original_id else dep for dep in ticket.depends_on],
            )
        )
    return result


def _parse_ticket(item: Any) -> DraftTicket:
    if not isinstance(item, dict):
        raise ValueError("ticket must be an object")
    title = _required_text(item, "title")
    criteria = item.get("acceptanceCriteria")
    depends_on = item.get("dependsOn", [])
    notes = item.get("implementationNotes")
    if not isinstance(criteria, list) or not criteria or not all(isinstance(text, str) and text for text in criteria):
        raise ValueError("ticket acceptanceCriteria must be non-empty strings")
    if not isinstance(depends_on, list) or not all(isinstance(text, str) and text for text in depends_on):
        raise ValueError("ticket dependsOn must be strings")
    if notes is not None and not isinstance(notes, str):
        raise ValueError("ticket implementationNotes must be text")
    ticket_id = item.get("id")
    if ticket_id is None:
        ticket_id = ""
    if not isinstance(ticket_id, str):
        raise ValueError("ticket id must be text")
    return DraftTicket(
        id=ticket_id,
        title=title,
        problem=_required_text(item, "problem"),
        acceptance_criteria=list(criteria),
        implementation_notes=notes,
        depends_on=list(depends_on),
    )


def _validate_dependencies(draft: ProjectDraft) -> None:
    ids = [ticket.id for ticket in draft.tickets if ticket.id]
    if not ids:
        raise ValueError("draft must include tickets")
    if len(ids) != len(draft.tickets):
        raise ValueError("ticket id is required")
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate ticket id")
    id_set = set(ids)
    for ticket in draft.tickets:
        for dependency in ticket.depends_on:
            if dependency not in id_set:
                raise ValueError(f"unknown dependency: {dependency}")
    visiting: set[str] = set()
    visited: set[str] = set()
    by_id = {ticket.id: ticket for ticket in draft.tickets}

    def visit(ticket_id: str) -> None:
        if ticket_id in visiting:
            raise ValueError("dependency cycle")
        if ticket_id in visited:
            return
        visiting.add(ticket_id)
        for dependency in by_id[ticket_id].depends_on:
            visit(dependency)
        visiting.remove(ticket_id)
        visited.add(ticket_id)

    for ticket_id in ids:
        visit(ticket_id)
    roots = [ticket.id for ticket in draft.tickets if not ticket.depends_on]
    if len(roots) != 1:
        raise ValueError("orphan tickets not reachable from project objective")
    dependents: dict[str, list[str]] = {ticket_id: [] for ticket_id in ids}
    for ticket in draft.tickets:
        for dependency in ticket.depends_on:
            dependents[dependency].append(ticket.id)
    reachable = {roots[0]}
    stack = [roots[0]]
    while stack:
        current = stack.pop()
        for dependent in dependents[current]:
            if dependent not in reachable:
                reachable.add(dependent)
                stack.append(dependent)
    if reachable != id_set:
        raise ValueError("orphan tickets not reachable from project objective")


def _required_text(item: dict[str, Any], key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be text")
    return value


def _tracked_files(repo: Path) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode == 0:
        return [line for line in result.stdout.splitlines() if line]
    return sorted(path.relative_to(repo).as_posix() for path in repo.rglob("*") if path.is_file() and ".git" not in path.parts)


def _row_to_ticket(row: sqlite3.Row) -> DraftTicket:
    return DraftTicket(
        id=str(row["ticket_id"]),
        title=str(row["title"]),
        problem=str(row["problem"]),
        acceptance_criteria=list(json.loads(str(row["acceptance_criteria"]))),
        implementation_notes=row["implementation_notes"],
        depends_on=list(json.loads(str(row["depends_on"]))),
    )


def _replace_ticket(ticket: DraftTicket, **changes: Any) -> DraftTicket:
    return DraftTicket(
        id=str(changes.get("id", ticket.id)),
        title=str(changes.get("title", ticket.title)),
        problem=str(changes.get("problem", ticket.problem)),
        acceptance_criteria=list(changes.get("acceptance_criteria", ticket.acceptance_criteria)),
        implementation_notes=changes.get("implementation_notes", ticket.implementation_notes),
        depends_on=list(changes.get("depends_on", ticket.depends_on)),
    )


def _require_ticket(tickets: list[DraftTicket], ticket_id: str) -> None:
    if all(ticket.id != ticket_id for ticket in tickets):
        raise ValueError(f"unknown ticket: {ticket_id}")


def _payload_text(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be text")
    return value


def _payload_texts(payload: dict[str, Any], key: str) -> list[str]:
    value = payload.get(key)
    if not isinstance(value, list) or not value or not all(isinstance(item, str) and item for item in value):
        raise ValueError(f"{key} must be non-empty strings")
    return list(value)


def _dedupe(items: Any) -> list[str]:
    result: list[str] = []
    for item in items:
        if item not in result:
            result.append(item)
    return result


def _unique_id(base: str, used: set[str]) -> str:
    candidate = _slug(base)
    original = candidate
    suffix = 2
    while candidate in used:
        candidate = f"{original}-{suffix}"
        suffix += 1
    return candidate


def _status(ticket: DraftTicket) -> str:
    if not ticket.depends_on:
        return "root"
    return "blocked"


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "ticket"


def _key(text: str) -> str:
    return " ".join(text.lower().split())
