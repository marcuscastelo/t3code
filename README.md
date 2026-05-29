# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex, Claude, and OpenCode, more coming soon).

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, and OpenCode.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## Fork-only features

This fork currently carries these features ahead of `upstream/main`.
Keep this table current when creating new feature branches, adding features, merging into `marucs-code`, or merging into `main`.

| Feature not in upstream                                                    | Branch holding it                                               | PR note                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------- |
| Appearance settings/theme system                                           | `origin/personal/pr-1550-appearance`                            | Clean, 8 commits             |
| Clear stale provider prompts                                               | `origin/fix/session-recovery/pr-1-clear-stale-provider-prompts` | Mostly clean, includes docs  |
| Durable Codex session history import                                       | `origin/feat/codex-session-importer/pr-1-importer-sync`         | Includes stale-prompt + docs |
| Project delete flow with thread count/force                                | `origin/fix/project-delete-force-retry`                         | Clean, 1 commit              |
| Tray/server controls, keep backend alive, offline state, pairing links     | `origin/t3code/kde-tray-server-controls`                        | Stacked, 20 commits          |
| Mobile-first main UI                                                       | `origin/mobile-design-v1`                                       | Clean, 1 commit              |
| Worklog details dialog + copy                                              | `origin/clickable-worklog`                                      | Clean, 1 commit              |
| Provider rate limits UI + Claude probing + pacing                          | `origin/provider-limits-ui`                                     | Clean, 3 commits             |
| Rate-limit pace delta percent/hours                                        | `origin/t3code/pp-hours`                                        | Stacked on provider limits   |
| Multi-device/thread orchestration events via WebSocket + connected devices | `origin/t3code/multi-device-thread-sync`                        | Stacked, 40 commits          |
| Commit/push/update-PR git action + tests/base-ref fix                      | `origin/update-pr-action`                                       | Stacked, 41 commits          |
| Background work in sidebar/timeline                                        | `origin/t3code/background-work-indicator`                       | Clean, 1 commit              |
| Fork workflow docs / MCP tooling notes                                     | `origin/marucs-code`                                            | No dedicated clean PR branch |

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
