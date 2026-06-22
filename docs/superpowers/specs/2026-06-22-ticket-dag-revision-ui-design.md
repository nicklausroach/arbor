# Ticket DAG Revision UI Design

## Goal
Build the draft-ticket revision loop for issue #4: users can view draft tickets as a left-to-right dependency DAG, edit the draft before approval, and only valid displayed graph states become immutable numbered versions.

## Scope
- Add graph validation and edit operations for draft tickets.
- Add a tiny local web UI using Python stdlib only.
- Keep all valid draft states in existing `draft_versions` / `draft_tickets` tables.
- Reject invalid LLM or direct-edit graph output without mutating the latest valid version.

## Non-goals
- No React/Vite/frontend build system.
- No production auth or multi-user server.
- No graph layout dependency; use simple dependency layers.

## Architecture
`arbor.drafting` remains the source of truth for draft tickets, persistence, stable IDs, and invariants. A new graph revision API validates each proposed draft, applies direct edit operations, renders graph layers, and writes a version only after validation succeeds.

`arbor.ui` exposes a small `http.server` app. It serves one HTML page and JSON endpoints for loading the latest graph and applying edits. Browser code stays plain HTML/CSS/JavaScript.

`arbor.__main__` gets a `serve-draft` command that starts the local UI for a project and database.

## Data model
Existing `DraftTicket` fields are sufficient:
- `id`
- `title`
- `problem`
- `acceptance_criteria`
- `implementation_notes`
- `depends_on`

Graph rendering adds derived data only:
- node id/title/status/layer
- edge source/target

## Validation rules
A draft is valid only when:
- every dependency points to an existing ticket;
- dependency graph is acyclic;
- at least one ticket exists;
- every ticket is reachable from a root ticket with no dependencies.

This treats disconnected rootless clusters as orphan tickets not reachable from the project objective.

## Edit operations
Direct edits operate on the latest valid draft and then validate before storing a new version:
- rename ticket;
- edit problem/body;
- replace acceptance criteria;
- add/remove dependency;
- delete ticket and remove incoming references;
- merge tickets;
- split ticket.

Merge behavior:
- creates a fresh stable ticket ID;
- combines title/problem text simply;
- curates acceptance criteria by preserving first occurrence order and removing duplicates;
- preserves external dependencies and dependents;
- removes self-edges among merged tickets.

Split behavior:
- replaces one ticket with supplied new tickets and new IDs;
- new tickets inherit the original external dependencies by default;
- caller may add internal ordering between split pieces;
- external dependents move to the last split piece;
- result validates before versioning.

## LLM revision repair
Invalid LLM graph output is parsed as untrusted input. If validation fails, Arbor returns an error and the previous valid draft. No version is created for invalid output. The returned previous draft is the repair context for the next LLM attempt.

## UI
The UI renders the latest valid draft as a left-to-right graph:
- columns are dependency layers;
- nodes are colored by status: root, blocked, ready;
- edges are drawn with SVG/HTML lines where practical, with textual dependency badges as fallback.

Editing controls are intentionally small:
- node form for title/problem/criteria;
- dependency add/remove controls;
- delete button;
- merge/split JSON textareas for uncommon operations.

## Testing
Tests cover:
- graph invariants: cycles, missing dependencies, orphan clusters;
- version creation only for valid drafts;
- merge repair behavior;
- split dependency inheritance and internal ordering;
- stable IDs across simple edits;
- invalid LLM output returns error and keeps previous version;
- UI server returns graph JSON and rejects invalid edit requests.
