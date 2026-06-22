import json
import subprocess
import sys
from pathlib import Path

from arbor.drafting import DraftStore, PlannerContext, ProjectDraft, validate_planner_output
from arbor.repo import connect_repository


def init_repo(path: Path, remote_url: str = "git@github.com:owner/demo.git") -> None:
    subprocess.run(["git", "init"], cwd=path, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=path, check=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=path, check=True)
    (path / "README.md").write_text("# Demo\nneedle\n", encoding="utf-8")
    (path / "src").mkdir()
    (path / "src" / "app.py").write_text("print('hello')\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=path, check=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=path, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["git", "remote", "add", "origin", remote_url], cwd=path, check=True)


def sample_planner_output(ticket_id: str = "repo-context") -> str:
    return json.dumps({
        "summary": "Plan repo-scoped work from pinned context.",
        "tickets": [
            {
                "id": ticket_id,
                "title": "Add repo context",
                "problem": "Planner needs read-only repository context.",
                "acceptanceCriteria": ["Lists tracked files", "Searches pinned paths"],
                "implementationNotes": "Use git and pathlib only.",
                "dependsOn": [],
            }
        ],
    })


def test_project_creation_persists_repo_scoped_draft(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    init_repo(repo)
    db = tmp_path / "arbor.sqlite"

    metadata = connect_repository(repo)
    store = DraftStore(db)
    project = store.create_project(
        title="Repo context",
        objective="Draft tickets for the selected repo only.",
        repository=metadata,
    )
    draft = validate_planner_output(sample_planner_output())
    version = store.save_planning_output(project.id, "planner json", draft)

    loaded = store.get_project(project.id)
    assert loaded.repository.local_path == repo
    assert loaded.objective == "Draft tickets for the selected repo only."
    assert version.summary == "Plan repo-scoped work from pinned context."
    assert version.tickets[0].id == "repo-context"
    assert version.raw_output == "planner json"


def test_planner_context_is_read_only_and_respects_pins(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    init_repo(repo)
    context = PlannerContext(repo, pinned_paths=(Path("README.md"),))

    assert "README.md" in context.tree()
    assert "src/app.py" not in context.tree()
    assert context.read_file("README.md") == "# Demo\nneedle\n"
    assert context.search("needle") == {"README.md": ["needle"]}
    assert not hasattr(context, "write_file")


def test_planner_context_rejects_tracked_symlink_escape(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    init_repo(repo)
    secret = tmp_path / "secret.txt"
    secret.write_text("secret", encoding="utf-8")
    (repo / "leak.txt").symlink_to(secret)
    subprocess.run(["git", "add", "leak.txt"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-m", "add symlink"], cwd=repo, check=True, stdout=subprocess.DEVNULL)

    context = PlannerContext(repo, pinned_paths=(Path("leak.txt"),))

    try:
        context.read_file("leak.txt")
    except ValueError as exc:
        assert "escapes repository" in str(exc)
    else:
        raise AssertionError("symlink escape accepted")


def test_connect_repository_accepts_ssh_github_remote(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    init_repo(repo, "ssh://git@github.com/owner/demo.git")

    metadata = connect_repository(repo)

    assert metadata.owner == "owner"
    assert metadata.name == "demo"


def test_planner_output_requires_structured_acyclic_json() -> None:
    draft = validate_planner_output(sample_planner_output())
    assert isinstance(draft, ProjectDraft)
    assert draft.tickets[0].acceptance_criteria == ["Lists tracked files", "Searches pinned paths"]

    bad = json.dumps({
        "summary": "bad",
        "tickets": [
            {"id": "a", "title": "A", "problem": "p", "acceptanceCriteria": ["x"], "dependsOn": ["b"]},
        ],
    })
    try:
        validate_planner_output(bad)
    except ValueError as exc:
        assert "unknown dependency" in str(exc)
    else:
        raise AssertionError("invalid dependency accepted")


def test_draft_ticket_ids_remain_stable_for_simple_title_edits(tmp_path: Path) -> None:
    store = DraftStore(tmp_path / "arbor.sqlite")
    repo = tmp_path / "repo"
    repo.mkdir()
    init_repo(repo)
    project = store.create_project("Repo context", "Objective", connect_repository(repo))

    first = store.save_planning_output(project.id, "first", validate_planner_output(sample_planner_output("old-id")))
    edited_json = json.dumps({
        "summary": "edited",
        "tickets": [
            {
                "id": "regenerated-id",
                "title": "Add repo context",
                "problem": "Edited wording.",
                "acceptanceCriteria": ["Still works"],
                "dependsOn": [],
            }
        ],
    })
    edited = store.save_planning_output(project.id, "edited", validate_planner_output(edited_json))

    assert first.tickets[0].id == "old-id"
    assert edited.tickets[0].id == "old-id"


def test_cli_draft_project_uses_prd_reference(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    init_repo(repo)
    db = tmp_path / "arbor.sqlite"
    output = tmp_path / "planner.json"
    output.write_text(sample_planner_output(), encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "arbor",
            "draft-project",
            "--db",
            str(db),
            "--repo",
            str(repo),
            "--title",
            "Repo context",
            "--objective",
            "Draft issue 3",
            "--planner-output",
            str(output),
        ],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        cwd=Path(__file__).resolve().parents[1],
    )

    assert "PRD: https://github.com/nicklausroach/arbor/issues/1" in result.stdout
    assert "project_id=1" in result.stdout
