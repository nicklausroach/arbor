from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RepositoryMetadata:
    local_path: Path
    owner: str
    name: str
    default_branch: str
    remote: str


def connect_repository(path: Path | str, remote: str = "origin") -> RepositoryMetadata:
    repo = Path(path).expanduser().resolve()
    if not (repo / ".git").exists():
        raise ValueError(f"not a git checkout: {repo}")
    if not is_clean(repo):
        raise ValueError("repository has uncommitted changes")
    url = _git(repo, "remote", "get-url", remote)
    owner, name = _parse_github_remote(url)
    branch = _default_branch(repo, remote)
    return RepositoryMetadata(repo, owner, name, branch, remote)


def is_clean(repo: Path) -> bool:
    return _git(repo, "status", "--porcelain") == ""


def _default_branch(repo: Path, remote: str) -> str:
    ref = _git(repo, "symbolic-ref", "--quiet", "--short", f"refs/remotes/{remote}/HEAD", check=False)
    if ref.startswith(f"{remote}/"):
        return ref.removeprefix(f"{remote}/")
    branch = _git(repo, "branch", "--show-current", check=False)
    return branch or "main"


def _parse_github_remote(url: str) -> tuple[str, str]:
    text = url.strip().removesuffix(".git")
    if text.startswith("git@github.com:"):
        path = text.removeprefix("git@github.com:")
    elif text.startswith("ssh://git@github.com/"):
        path = text.removeprefix("ssh://git@github.com/")
    elif text.startswith("https://github.com/"):
        path = text.removeprefix("https://github.com/")
    else:
        raise ValueError(f"remote is not GitHub: {url}")
    parts = path.split("/")
    if len(parts) != 2 or not all(parts):
        raise ValueError(f"remote is not owner/repo GitHub URL: {url}")
    return parts[0], parts[1]


def _git(repo: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check and result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "git command failed"
        raise ValueError(message)
    if result.returncode != 0:
        return ""
    return result.stdout.strip()
