import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

from arbor.connect import (
    DirtyRepositoryError,
    connect_repository,
    ensure_clean_for_execution,
)


class FakeKeychain:
    def __init__(self):
        self.saved = []

    def save_token(self, owner: str, repo: str, token: str) -> None:
        self.saved.append((owner, repo, token))


class FakeGithub:
    def __init__(self, default_branch: str = "main"):
        self.default_branch = default_branch
        self.verified = []

    def verify_repo(self, owner: str, repo: str, token: str) -> str:
        self.verified.append((owner, repo, token))
        return self.default_branch


class ConnectRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-b", "main"], cwd=self.repo, check=True, capture_output=True)
        subprocess.run(["git", "remote", "add", "origin", "git@github.com:octo/arbor.git"], cwd=self.repo, check=True)
        (self.repo / "README.md").write_text("hello\n")
        subprocess.run(["git", "add", "README.md"], cwd=self.repo, check=True)
        subprocess.run(
            ["git", "-c", "user.email=a@example.com", "-c", "user.name=A", "commit", "-m", "init"],
            cwd=self.repo,
            check=True,
            capture_output=True,
        )
        self.db = Path(self.tmp.name) / "arbor.sqlite"

    def test_connects_origin_github_remote_and_persists_non_secret_metadata(self):
        keychain = FakeKeychain()
        github = FakeGithub(default_branch="trunk")

        record = connect_repository(self.repo, "ghp_secret", self.db, keychain, github)

        self.assertEqual(record.owner, "octo")
        self.assertEqual(record.repo, "arbor")
        self.assertEqual(record.default_branch, "trunk")
        self.assertEqual(record.remote, "origin")
        self.assertEqual(record.local_path, self.repo)
        self.assertEqual(keychain.saved, [("octo", "arbor", "ghp_secret")])
        self.assertEqual(github.verified, [("octo", "arbor", "ghp_secret")])

        rows = sqlite3.connect(self.db).execute(
            "select owner, repo, default_branch, remote, local_path from repositories"
        ).fetchall()
        self.assertEqual(rows, [("octo", "arbor", "trunk", "origin", str(self.repo))])
        dump = "\n".join(sqlite3.connect(self.db).iterdump())
        self.assertNotIn("ghp_secret", dump)

    def test_non_origin_github_remote_requires_explicit_choice(self):
        subprocess.run(["git", "remote", "remove", "origin"], cwd=self.repo, check=True)
        subprocess.run(["git", "remote", "add", "upstream", "https://github.com/octo/arbor.git"], cwd=self.repo, check=True)

        with self.assertRaises(ValueError):
            connect_repository(self.repo, "token", self.db, FakeKeychain(), FakeGithub())

        record = connect_repository(self.repo, "token", self.db, FakeKeychain(), FakeGithub(), remote_name="upstream")
        self.assertEqual(record.remote, "upstream")

    def test_refuses_execution_when_base_repo_has_uncommitted_changes(self):
        (self.repo / "dirty.txt").write_text("dirty\n")

        with self.assertRaises(DirtyRepositoryError):
            ensure_clean_for_execution(self.repo)

    def test_connect_does_not_mutate_git_config(self):
        before = subprocess.check_output(["git", "config", "--local", "--list"], cwd=self.repo, text=True)

        connect_repository(self.repo, "token", self.db, FakeKeychain(), FakeGithub())

        after = subprocess.check_output(["git", "config", "--local", "--list"], cwd=self.repo, text=True)
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
