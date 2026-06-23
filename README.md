# <img src="logo.svg" alt="Arbor" width="48" height="48" /> Arbor

**Arbor** is a dependency-aware coding tool that helps teams plan and execute complex software projects. It turns high-level objectives into structured, dependency-aware task graphs and coordinates agent-based execution with full traceability.

## Features

- **Intelligent Planning** - Uses Claude to transform project objectives into dependency-aware DAGs of granular tickets
- **Dependency Management** - Automatically handles ticket dependencies and ensures correct execution order
- **Agent Orchestration** - Coordinates parallel agent execution with concurrency limits and proper dependency ordering
- **Live Feedback** - Stream planner thinking and agent progress in real-time through the UI
- **GitHub Integration** - Creates issues, manages PRs, and tracks progress automatically
- **Session Debugging** - Connect to running or failed agent sessions for real-time debugging and steering
- **Version Control** - Maintains full history of plan versions, allowing rollback and comparison

## How It Works

1. **Connect Repository** - Point Arbor at a local git repository and authorize GitHub access
2. **Define Objective** - Describe what you want to build
3. **AI Planning** - Claude analyzes your codebase and objectives, generates a structured plan
4. **Review & Edit** - Approve the plan or edit tickets and dependencies
5. **Execute** - Agents run tickets in dependency order, creating branches and PRs
6. **Monitor** - Watch progress in real-time or connect to sessions for debugging
7. **Merge** - Once complete, merge PRs and mark the project done

## Quick Start

### Prerequisites

- Node.js 18+ 
- macOS or Linux (uses Unix PTY APIs)
- A local git repository
- GitHub account with a PAT (Personal Access Token)
- Anthropic API key (for Claude access)

### Installation

```bash
# Install dependencies
npm install

# Start development servers
npm run dev

# Frontend runs on http://localhost:5173
# Backend runs on http://localhost:4310
```

### Configuration

1. Open the app and go to Settings
2. Add your GitHub PAT (stored in OS keychain)
3. Add your Anthropic API key (stored in OS keychain)
4. Optionally configure the agent command (default: `claude -p --dangerously-skip-permissions`)
5. Set max concurrency for parallel agent execution

## Architecture

### Core Components

**Frontend** (`web/`)
- React application with real-time UI updates
- WebSocket connections for streaming planner output and agent sessions
- DAG visualization with pan/zoom
- Integrated terminal for session debugging

**Backend** (`server/`)
- Express server with REST API
- SQLite database for project state
- Scheduler (`tick.ts`) that manages ticket lifecycle and agent dispatch
- GitHub integration for issue/PR management
- PTY wrapper for agent session management

### Workflow

```
Plan (User Input)
    ↓
Planner (Claude) → Validates DAG
    ↓
Approve → Store Graph Version
    ↓
Scheduler.tick()
    ├─ Recover running/failed tickets with PRs
    ├─ Promote review → merged
    ├─ Promote blocked → ready (when deps merge)
    └─ Dispatch ready → running (up to concurrency limit)
    ↓
Agent (Claude)
    ├─ Creates branch
    ├─ Implements ticket
    ├─ Opens PR
    └─ (Can be debugged via session)
    ↓
Merge → Done
```

### Data Model

**Projects** - Contain objectives, status, and linked GitHub milestones
**Tickets** - Granular work items with dependencies, acceptance criteria, and status
**Runs** - Individual agent execution attempts with branch, PR, and session info
**Chat History** - Conversation with the planner for auditing and context

## Development

### Key Files

- `web/src/App.tsx` - Main app layout
- `web/src/PlanView.tsx` - Planning interface
- `web/src/RunView.tsx` - Execution interface
- `server/src/scheduler/tick.ts` - Scheduler logic
- `server/src/planner/anthropicProvider.ts` - Planner integration
- `server/src/runner/runner.ts` - Agent execution

### Testing

```bash
# Run tests
npm test

# Tests for planner validation, scheduler logic, etc.
```

### Build

```bash
# Build frontend
npm run build -w web

# Build backend
npm run build -w server
```

## Ticket Lifecycle

```
draft → blocked → ready → running → review → merged
                    ↑                     ↓
                    └─ (failed) ←────────┘
```

- **draft** - Initial state after planning
- **blocked** - Waiting for upstream dependencies
- **ready** - All dependencies merged, eligible to run
- **running** - Agent is actively working
- **review** - PR created, waiting for review/merge
- **merged** - PR merged to main
- **failed** - Agent run failed (can recover if PR exists)

## Contributing

Contributions are welcome! Areas for improvement include:

- Additional validation rules for DAGs
- Smarter dependency inference from code
- Integration with other VCS platforms
- Extended agent capabilities
- UI enhancements

## License

MIT
