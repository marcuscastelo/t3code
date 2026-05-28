# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Tooling Notes

- Context-mode MCP commands may not inherit the current shell `workdir`. For repository commands, explicitly prefix the command with `cd <absolute path from environment_context.cwd> &&` before `rtk`; do not assume `apps/` or `packages/` exists in the tool's default cwd.

## Fork And Git Workflow

This checkout is a personal fork workflow.

Remotes:

- `origin`: `https://github.com/marcuscastelo/t3code`
- `upstream`: `https://github.com/pingdotgg/t3code`

Branch roles:

- `upstream/main` is the read-only source of truth for new work.
- `main` means local `main`.
- local `main` tracks and must stay identical to `origin/main`.
- `origin/main` must not diverge from local `main`.

New branches:

- Always create new work branches from `upstream/main`.
- Do not base new branches on local `main` or another personal branch unless explicitly requested.
- Name stacked feature branches explicitly: `feat/<feature-name>/pr-1-<description>`, `feat/<feature-name>/pr-2-<description>`, and so on.
- This keeps unrelated fork customizations out of new work and preserves the option to make upstream PRs later.

Integration flow:

- Before merging any work into fork `main`, create or update the PR-ready branch that points at that work commit.
- Push that PR-ready branch to `origin` before merging it into local `main`.
- Merge the pushed work branch into local `main`.
- Push local `main` to `origin/main`; this is the fork remote, not `upstream`.
- Periodically sync from `upstream/main` into local `main`, then push local `main` to `origin/main`.
- Never push to `upstream`; treat it as read-only.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
