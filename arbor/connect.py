from __future__ import annotations

import re
import sqlite3
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class DirtyRepositoryError(RuntimeError):
    pass


class Keychain(Protocol):
    def save_token(self, owner: str, repo: str, token: str) -> None: ...


class GithubApi(Protocol):
    def verify_repo(self, owner: str, repo: str, token: str) -> str: ...


@dataclass(frozen=True)
class RepositoryRecord:
    owner: str
    repo: str
    default_branch: str
    remote: str
    local_path: Path


@dataclass(frozen=True)
class Remote:
    name: str
    owner: str
    repo: str


_GITHUB_PATTERNS = (
    re.compile(r"^git@github\.com:(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?$"),
    re.compile(r"^https://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?/?$"),
)


def connect_repository(
    path: Path,
    token: str,
    db_path: Path,
    keychain: Keychain,
    github: GithubApi,
    remote_name: str | None = None,
) -> RepositoryRecord:
    path = Path(path)
    remote = _select_remote(_github_remotes(path), remote_name)
    default_branch = github.verify_repo(remote.owner, remote.repo, token)
    keychain.save_token(remote.owner, remote.repo, token)
    record = RepositoryRecord(remote.owner, remote.repo, default_branch, remote.name, path)
    _save_repository(db_path, record)
    return record


def ensure_clean_for_execution(path: Path) -> None:
    status = _git(path, "status", "--porcelain")
    if status.strip():
        raise DirtyRepositoryError(f"repository has uncommitted changes: {path}")


def _github_remotes(path: Path) -> list[Remote]:
    output = _git(path, "remote", "-v")
    remotes: dict[str, Remote] = {}
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        name, url = parts[0], parts[1]
        parsed = _parse_github_url(url)
        if parsed is not None:
            remotes.setdefault(name, Remote(name, *parsed))
    return list(remotes.values())


def _select_remote(remotes: list[Remote], remote_name: str | None) -> Remote:
    if remote_name is not None:
        for remote in remotes:
            if remote.name == remote_name:
                return remote
        raise ValueError(f"GitHub remote not found: {remote_name}")

    for remote in remotes:
        if remote.name == "origin":
            return remote

    if not remotes:
        raise ValueError("no GitHub remotes found")
    raise ValueError("origin is not a GitHub remote; choose a GitHub remote explicitly")


def _parse_github_url(url: str) -> tuple[str, str] | None:
    for pattern in _GITHUB_PATTERNS:
        match = pattern.match(url)
        if match:
            return match.group("owner"), match.group("repo")
    return None


def _save_repository(db_path: Path, record: RepositoryRecord) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as db:
        db.execute(
            """
            create table if not exists repositories (
                owner text not null,
                repo text not null,
                default_branch text not null,
                remote text not null,
                local_path text not null,
                primary key (owner, repo, local_path)
            )
            """
        )
        db.execute(
            """
            insert into repositories (owner, repo, default_branch, remote, local_path)
            values (?, ?, ?, ?, ?)
            on conflict(owner, repo, local_path) do update set
                default_branch=excluded.default_branch,
                remote=excluded.remote
            """,
            (record.owner, record.repo, record.default_branch, record.remote, str(record.local_path)),
        )


def _git(path: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(path), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


