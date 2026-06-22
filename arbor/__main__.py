from __future__ import annotations

import argparse
from pathlib import Path

from . import PRD_URL
from .drafting import DraftStore, validate_planner_output
from .repo import connect_repository


def main() -> None:
    parser = argparse.ArgumentParser(prog="arbor")
    subparsers = parser.add_subparsers(dest="command", required=True)
    draft = subparsers.add_parser("draft-project")
    draft.add_argument("--db", required=True, type=Path)
    draft.add_argument("--repo", required=True, type=Path)
    draft.add_argument("--title", required=True)
    draft.add_argument("--objective", required=True)
    draft.add_argument("--planner-output", required=True, type=Path)
    args = parser.parse_args()

    if args.command == "draft-project":
        repository = connect_repository(args.repo)
        store = DraftStore(args.db)
        project = store.create_project(args.title, args.objective, repository)
        raw_output = args.planner_output.read_text(encoding="utf-8")
        version = store.save_planning_output(project.id, raw_output, validate_planner_output(raw_output))
        print(f"project_id={project.id}")
        print(f"draft_version_id={version.id}")
        print(f"PRD: {PRD_URL}")


if __name__ == "__main__":
    main()
