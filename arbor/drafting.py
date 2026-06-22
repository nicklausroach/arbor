from __future__ import annotations

import json
import re
import sqlite3
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .repo import RepositoryMetadata


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
            raise ValueError(f"path is outside pinned planning context: {relative}")
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
        files = _tracked_files(self.repo)
        if not self.pinned_paths:
            return files
        pins = [pin.as_posix().rstrip("/") for pin in self.pinned_paths]
        return [name for name in files if any(name == pin or name.startswith(f"{pin}/") for pin in pins)]

    def _safe_relative(self, path: str | Path) -> Path:
        relative = Path(path)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"unsafe path: {path}")
        return relative

    def _read_visible_file(self, relative: Path) -> Path:
        resolved = (self.repo / relative).resolve()
        try:
            resolved.relative_to(self.repo)
        except ValueError:
            raise ValueError(f"path escapes repository: {relative}") from None
        if not resolved.is_file():
            raise ValueError(f"path is not a file: {relative}")
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
        with self._connect() as conn:
            cursor = conn.execute(
                "INSERT INTO draft_versions (project_id, summary, raw_output) VALUES (?, ?, ?)",
                (project_id, draft.summary, raw_output),
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
        return DraftVersion(version_id, project_id, draft.summary, raw_output, tickets)

    def _stabilize_ticket_ids(self, project_id: int, tickets: list[DraftTicket]) -> list[DraftTicket]:
        previous = self._latest_tickets(project_id)
        by_title = {_key(ticket.title): ticket.id for ticket in previous}
        used: set[str] = set()
        stable = []
        for ticket in tickets:
            ticket_id = by_title.get(_key(ticket.title)) or ticket.id or _slug(ticket.title)
            original = ticket_id
            suffix = 2
            while ticket_id in used:
                ticket_id = f"{original}-{suffix}"
                suffix += 1
            used.add(ticket_id)
            stable.append(
                DraftTicket(
                    id=ticket_id,
                    title=ticket.title,
                    problem=ticket.problem,
                    acceptance_criteria=ticket.acceptance_criteria,
                    implementation_notes=ticket.implementation_notes,
                    depends_on=ticket.depends_on,
                )
            )
        _validate_dependencies(ProjectDraft("", stable))
        return stable

    def _latest_tickets(self, project_id: int) -> list[DraftTicket]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id FROM draft_versions WHERE project_id = ? ORDER BY id DESC LIMIT 1", (project_id,)
            ).fetchone()
            if row is None:
                return []
            rows = conn.execute("SELECT * FROM draft_tickets WHERE version_id = ?", (row["id"],)).fetchall()
        return [_row_to_ticket(row) for row in rows]

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
        raise ValueError(f"planner output is not JSON: {exc.msg}") from None
    if not isinstance(data, dict):
        raise ValueError("planner output must be a JSON object")
    summary = data.get("summary")
    raw_tickets = data.get("tickets")
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError("planner output needs summary")
    if not isinstance(raw_tickets, list) or not raw_tickets:
        raise ValueError("planner output needs tickets")
    tickets = [_parse_ticket(item) for item in raw_tickets]
    draft = ProjectDraft(summary, tickets)
    _validate_dependencies(draft)
    return draft


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
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate ticket id")
    id_set = set(ids)
    for ticket in draft.tickets:
        for dependency in ticket.depends_on:
            if dependency not in id_set:
                raise ValueError(f"unknown dependency: {dependency}")
    visiting: set[str] = set()
    visited: set[str] = set()
    by_id = {ticket.id: ticket for ticket in draft.tickets if ticket.id}

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


def _required_text(item: dict[str, Any], key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"ticket {key} must be text")
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


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "ticket"


def _key(text: str) -> str:
    return " ".join(text.lower().split())
