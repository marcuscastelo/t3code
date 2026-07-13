# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Fork management with Forksmith

This personal fork uses Forksmith as the durable authority for reconciliation,
Change lineage, validation evidence, and publication.

- `upstream/main` is read-only and supplies the snapshot for new fork work.
- `forksmith/meta` owns Forksmith configuration, Change intent, and audit
  metadata. Never edit it or its SQLite state directly.
- `forksmith/integration` is the managed composition branch. `main` is its
  publication mirror and must remain identical to `origin/main`.
- Begin fork work with `forksmith help --json`, `forksmith inspect --json`, and
  `forksmith status --json`, then follow the returned `next_actions` instead
  of inventing a parallel Git topology.
- Use `forksmith check --json`, `forksmith plan --json`, and
  `forksmith sync --json` for upstream reconciliation. `check` is the explicit
  upstream refresh boundary; `plan` is read-only.
- Register each fork change with a stable Forksmith Change ID and an explicit
  branch name such as `feat/<feature-name>/pr-1-<description>`. Its initial
  implementation may be developed on that canonical branch; later work belongs
  only in the push-disabled Forksmith draft or semantic-job clone.
- Preserve existing divergent history through `forksmith change import` or
  `forksmith change attach-legacy`. Equality with upstream is never proof that
  a behavior was absorbed.
- Never manually merge a Forksmith Change into `main`, move a canonical ref,
  or push reconciliation work. Only `forksmith publish <run-id>` may publish
  Forksmith-managed refs; `upstream` is always read-only.

Read [docs/operations/forksmith.md](./docs/operations/forksmith.md) before
starting, submitting, or publishing a fork Change.

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
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.
