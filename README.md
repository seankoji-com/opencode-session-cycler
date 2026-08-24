# opencode-session-cycler

[![CI](https://github.com/seankoji-com/opencode-session-cycler/actions/workflows/ci.yml/badge.svg)](https://github.com/seankoji-com/opencode-session-cycler/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/seankoji-com/opencode-session-cycler/graph/badge.svg)](https://codecov.io/gh/seankoji-com/opencode-session-cycler)

Next / previous / toggle-last session keybinds for the [OpenCode](https://opencode.ai) TUI — no session dialog required.

OpenCode's TUI shows one session at a time. Switching means opening the session list (`<leader>l`) and picking, or pre-pinning up to 9 quick slots. This plugin adds what the editor-grade harnesses have: cycle through your recent sessions and flip back to whatever you were just reading.

- `alt+j` → next session (most-recently-updated first)
- `alt+k` → previous session
- `<leader>o` → toggle back to the last session you were on (Emacs `C-x o` style)
- `alt+s` → show/hide the sessions sidebar widget

Each action is registered as a keymap command (`session_cycler.next`, `session_cycler.previous`, `session_cycler.last`, `session_cycler.sidebar`) — those ids are what the rebinding examples below hook into.

## Requirements

OpenCode ≥ 1.18 (TUI plugin API).

## Install

Add to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-session-cycler"]
}
```

Restart OpenCode. The plugin auto-installs from npm on startup.

### Custom bindings

Either pass options via the tuple form:

```json
{
  "plugin": [["opencode-session-cycler", { "bindings": { "next": "alt+n", "previous": "alt+p" } }]]
}
```

…or rebind by command id in `tui.json` `keybinds`:

```json
{
  "keybinds": {
    "session_cycler.next": "alt+j",
    "session_cycler.previous": "alt+k",
    "session_cycler.last": "<leader>o",
    "session_cycler.sidebar": "alt+s"
  }
}
```

The defaults deliberately avoid `ctrl+left` / `ctrl+right`: OpenCode core binds those to word-wise cursor movement in the prompt input (`input_word_backward` / `input_word_forward`), and the input editor consumes the keypress before plugin keymap layers see it.

> **macOS note:** use the **left** Option key. WezTerm-style setups treat left-alt as a meta/escape prefix, while right-alt composes special characters.

## Behavior

- **Order** — sessions sorted by most recently updated, wrapping at both ends.
- **Scope** — child/subagent sessions never appear in the cycle. When you're inside a session, cycling stays within that session's project so you don't land in another directory's work.
- **Toggle-last** — tracks the previous session in memory only; it resets when the TUI restarts. External navigation (picking from the session dialog, quick slots, launching with `--session`) is detected correctly: after you hand-navigate somewhere, `<leader>o` takes you back to where you were before that.
- **Feedback** — a brief toast names the session you landed on; empty states toast instead of failing silently ("No sessions yet", "No previous session", "Previous session is gone", and "No other sessions" when the current project has only one session).

## Sidebar widget

The plugin renders a collapsible **Sessions (N)** widget into the TUI sidebar (the same pane as todos and context usage). Each row:

```
⏳ refactori auth token e
✅ review-f PR feedback
⚠️ migrati schema drif
```

- **Status emoji** — ⏳ the agent is working (`busy`), ⚠️ the provider is retrying or the latest assistant turn failed, ✅ waiting for you.
- **Title** — first 10 characters of the session title (session id as fallback).
- **Latest message** — first 10 characters of the newest message's text.
- **Highlight** — the row for the session you're currently viewing uses the theme's selected-item color; the rest are muted.

Scope matches the keybinds: subagents are excluded, and while you're inside a session the list shows that session's project only.

**Collapse/expand** — click the `Sessions (N)` header or press `alt+s`. The state persists across restarts. On hosts without slot support the widget is skipped and `<leader>s` toasts "Sidebar unavailable" — the keybinds keep working.

**Freshness** — the list refetches on `session.created` / `updated` / `deleted` events (bursty events coalesce within 100 ms), while per-row status and message previews read OpenCode's reactive session state directly, so rows update live as turns stream.

**Reactivity limitation** — the widget renders on initial mount and route changes, but internal state changes (toggle collapse, session list updates) only become visible on the next host-driven re-render (route changes, token streaming). This is a host architectural gap: plugin signals don't trigger host re-renders; the host only re-invokes slot functions when its own state changes. The builtin todo/context widgets work because they read directly from `api.state.*` (host-reactive), not their own signals.

## Troubleshooting

**Keys do nothing**

- **macOS** — use the *left* Option key (see the note above); right-Option composes characters like `∆` instead of sending Alt.
- **Stale cache** — OpenCode resolves `@latest` once and caches it. Check `~/.cache/opencode/packages/opencode-session-cycler@latest/node_modules/opencode-session-cycler/package.json` matches the latest published version; if not, delete that directory and restart OpenCode to force a re-resolve.
- **Single-session project** — with only one session in scope there's nothing to cycle to; you'll get a "No other sessions" toast.

## Why a plugin?

Upstream has open requests for exactly this ([#40557](https://github.com/anomalyco/opencode/issues/40557), [#16986](https://github.com/anomalyco/opencode/issues/16986), [#26172](https://github.com/anomalyco/opencode/issues/26172)) and two abandoned attempts (#16984, #17246). Rather than wait, this implements it against the public TUI plugin API — if it lands in core later, uninstall and move on.

## Development

```sh
bun install
bun run lint
bun run typecheck
bun test
```

To try a local checkout, point `tui.json` at the file instead of the npm spec:

```json
{
  "plugin": ["/absolute/path/to/opencode-session-cycler/src/index.ts"]
}
```

**Packaging note:** OpenCode resolves npm TUI plugins exclusively through `package.json` `exports["./tui"]` — it does not fall back to `"main"` (that fallback exists only for server plugins). A TUI package without the export is silently skipped at load. Both `.` and `./tui` must point at `dist/index.js`; a regression test in `test/index.test.ts` guards this.

**JSX pipeline:** the sidebar view is Solid JSX (`src/sidebar.tsx`) compiled by Bun's automatic transform against `@opentui/solid/jsx-runtime` (see `tsconfig.json` `jsx` / `jsxImportSource`). The build externalizes `@opentui/*`, `solid-js`, and `@opencode-ai/plugin` — they ship as real dependencies and resolve through the package's own `node_modules` when OpenCode installs it — and defines `NODE_ENV=production` so the dev JSX runtime doesn't leak into the bundle. Under `bun test`, `test/preload.ts` stubs the jsx-runtime so components render as plain inspectable objects without a terminal renderer.

## Releasing

Two equivalent paths — both run checks, build `dist/`, and publish to npm:

- **Actions UI**: *Actions → Release → Run workflow* (on `main`), pick **breaking / minor / bugfix**. The workflow opens a short-lived `release/vX.Y.Z` PR (satisfying protected-main rules like CodeQL), waits for it to merge, tags the merged commit, and publishes.
- **Tag push**: bump `package.json` via a PR, then `git tag v0.1.0 && git push origin v0.1.0`.

Publishing uses npm trusted publishing (OIDC): the workflow's `id-token: write` permission plus the trusted publisher configured on the npm package (repo `seankoji-com/opencode-session-cycler`, workflow `release.yml`) replace any stored token. For fully hands-off releases, add a `RELEASE_PAT` secret (a PAT with repo contents + pull-request write): the release PR is then authored by you, so its checks skip GitHub's "workflow awaiting approval" gate that applies to bot-authored PRs. Without it, each release PR needs one manual "Approve and run" click.

## License

[MIT](./LICENSE)
