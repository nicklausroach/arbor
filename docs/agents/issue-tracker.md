# Issue tracker: GitHub Issues

PRDs and implementation issues live in GitHub Issues for `nicklausroach/arbor`. Use the `gh` CLI from this repository checkout.

## Conventions

- Create issue: `gh issue create --title "..." --body "..."`.
- Read issue: `gh issue view <number> --comments`.
- List issues: `gh issue list --state open --json number,title,body,labels,comments`.
- Comment: `gh issue comment <number> --body "..."`.
- Label: `gh issue edit <number> --add-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

## Pull requests triage surface

PRs request surface: no.
