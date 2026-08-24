# opencode-session-cycler

Next / previous / toggle-last session keybinds for the [OpenCode](https://opencode.ai) TUI — no session dialog required.

OpenCode's TUI shows one session at a time. Switching means opening the session list (`<leader>l`) and picking, or pre-pinning up to 9 quick slots. This plugin adds what the editor-grade harnesses have: cycle through your recent sessions and flip back to whatever you were just reading.

- `ctrl+right` → next session (most-recently-updated first)
- `ctrl+left` → previous session
- `<leader>o` → toggle back to the last session you were on (Emacs `C-x o` style)

All three are also registered in the command palette under **Session** (`Ctrl+P` → "Next/Previous/Toggle last session").

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
  "plugin": [["opencode-session-cycler", { "bindings": { "next": "alt+j", "previous": "alt+k" } }]]
}
```

…or rebind by command id in `tui.json` `keybinds`:

```json
{
  "keybinds": {
    "session_cycler.next": "alt+j",
    "session_cycler.previous": "alt+k",
    "session_cycler.last": "<leader>o"
  }
}
```

The defaults deliberately avoid `[` / `]`, which need Option on non-US Mac layouts.

> **macOS note:** `ctrl+left` / `ctrl+right` default to "move between Spaces" in Mission Control. If cycling does nothing, disable those under **System Settings → Keyboard → Keyboard Shortcuts → Mission Control**, or rebind the plugin to something else.

## Behavior

- **Order** — sessions sorted by most recently updated, wrapping at both ends.
- **Scope** — child/subagent sessions never appear in the cycle. When you're inside a session, cycling stays within that session's project so you don't land in another directory's work.
- **Toggle-last** — tracks the previous session in memory only; it resets when the TUI restarts. External navigation (picking from the session dialog, quick slots, launching with `--session`) is detected correctly: after you hand-navigate somewhere, `<leader>o` takes you back to where you were before that.
- **Feedback** — a brief toast names the session you landed on; empty states ("No sessions yet", "No previous session") toast instead of failing silently.

## Why a plugin?

Upstream has open requests for exactly this ([#40557](https://github.com/anomalyco/opencode/issues/40557), [#16986](https://github.com/anomalyco/opencode/issues/16986), [#26172](https://github.com/anomalyco/opencode/issues/26172)) and two abandoned attempts (#16984, #17246). Rather than wait, this implements it against the public TUI plugin API — if it lands in core later, uninstall and move on.

## Development

```sh
bun install
bun run typecheck
bun test
```

To try a local checkout, point `tui.json` at the file instead of the npm spec:

```json
{
  "plugin": ["/absolute/path/to/opencode-session-cycler/src/index.ts"]
}
```

## Releasing

Two equivalent paths — both run checks, build `dist/`, and publish to npm:

- **Actions UI**: *Actions → Release → Run workflow* (on `main`), pick **breaking / minor / bugfix**. The workflow opens a short-lived `release/vX.Y.Z` PR (satisfying protected-main rules like CodeQL), waits for it to merge, tags the merged commit, and publishes.
- **Tag push**: bump `package.json` via a PR, then `git tag v0.1.0 && git push origin v0.1.0`.

Publishing requires the `NPM_TOKEN` repository secret.

## License

[MIT](./LICENSE)
