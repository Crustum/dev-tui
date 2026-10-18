# @crustum/dev-tui

OpenTUI dev process runner — tabbed TUI for running multiple commands simultaneously with searchable, scrollable output. Port of `@crustum/multiplex` (Ink/React) to `@opentui/core` (imperative, Windows-friendly, mouse support), sharing the `workspace/log-tui` shell know-how.

When you exit, the interleaved output is flushed to your terminal scrollback so you don't lose your logs, up to the `--stream-buffer-size` limit.

Without an interactive terminal — piped, redirected, or in CI — it runs inline instead: same labelled, interleaved output, printed as it arrives, with no TUI. A terminal too small for the TUI, or one whose stdin won't enter raw mode, falls back the same way (says so on stderr) rather than crashing.

## Install

```bash
npm install -g @crustum/dev-tui
```

Or run directly:

```bash
npx @crustum/dev-tui 'server,php bin/cake.php server' 'queue,php bin/cake.php queue worker'
```

## Usage

```bash
dev-tui [options] <commands...>
# commands as label,command or label@color,command
```

| Option | Description |
|---|---|
| `-s, --stream` | Start in stream mode (P2 TUI; accepted today, runs inline until the TUI lands) |
| `--tabs` | Start in tabs mode (default once the TUI lands) |
| `-i, --inline` | Print output inline instead of rendering the TUI |
| `--json` | Emit newline-delimited JSON events. Implies `--inline` |
| `--buffer-size <n>` | Max lines per command buffer (default: `2000`) |
| `--stream-buffer-size <n>` | Max lines in the stream buffer (default: `10000`) |
| `--timestamps` | Display timestamps on each output line |
| `--no-restart` | Disable auto-restart on crash |
| `--title <name>` | Set the terminal tab title |
| `--dry-run` | Print the resolved invocation without starting anything |
| `--fake` | Run synthetic process output instead of spawning (for demos/tests) |
| `--theme <name>` | Chrome theme: dark or light |
| `--runner <name>` | Accepted for `bin/cake dev` compat (`opentui`); anything else errors |

## Build / test

```bash
bun install
bun run build
bun run test      # node:test suites (tsx runner): proc/ + tui/
bun test          # everything bun finds, including the node:test suites above
bun run test:all  # all tests: tsx suites, then TestRenderer integration in src/ui/
```

Node fallback: `node --test --import tsx` works for the `test` script (needs Node >= 26.4).
