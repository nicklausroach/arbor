# Connect Local GitHub Repo Design

## Scope
Implement issue #2 only: connect an existing local GitHub checkout, verify GitHub API access, persist non-secret repository metadata, and keep tokens behind a keychain boundary.

## Approach
Use a tiny Python stdlib module. No dependencies, no cloning, no hooks, no repo config mutation.

## Components
- `arbor/connect.py`: repo remote detection, clean-tree check, GitHub API verification boundary, SQLite metadata persistence, and keychain protocol.
- `tests/test_connect.py`: unittest coverage for issue #2 acceptance criteria.

## Behavior
- Git remotes are read with `git -C <path> remote -v`.
- `origin` is selected when it is a GitHub remote; otherwise callers must choose among detected GitHub remotes.
- Repository metadata saved in SQLite: owner, repo name, default branch, remote name, local path.
- Tokens are written only through the injected keychain boundary, never SQLite.
- Execution-related checks fail when `git status --porcelain` is non-empty.

## Out of scope
No GUI, cloning, hooks, new remotes, hosted execution, or downstream issue work.
