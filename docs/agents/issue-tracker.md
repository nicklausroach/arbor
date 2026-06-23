# Issue tracker: GitHub Issues

Issues and PRDs live in GitHub Issues for `nicklausroach/arbor`. Use the `gh` CLI from this repository checkout.

## Conventions

- Create issue: `gh issue create --title "..." --body "..."`.
- Read issue: `gh issue view <number> --comments`.
- List issues: `gh issue list --state open --json number,title,body,labels,comments`.
- Comment: `gh issue comment <number> --body "..."`.
- Label: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

`gh` infers the repo from `git remote` when run inside this checkout.

## Pull requests triage surface

PRs request surface: no.

Do not pull external PRs into the request-triage queue. Treat GitHub Issues as the request surface for this repo.
