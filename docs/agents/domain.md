# Domain Docs

This is a single-context repo.

## Before exploring

Read these when they exist:

- `CONTEXT.md` at the repo root.
- `docs/adr/` at the repo root.

If either path is absent, proceed silently. Do not suggest creating domain docs up front; `/domain-modeling` should add terms or decisions only when the work actually needs them.

## Consumer rules

- Use glossary vocabulary from `CONTEXT.md` in issue titles, PRDs, implementation plans, tests, and code comments.
- If a needed concept is missing, note that `/domain-modeling` should add it instead of inventing competing names.
- If work contradicts an existing ADR, flag that contradiction explicitly instead of silently overriding the decision.
