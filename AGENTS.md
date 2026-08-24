# AGENTS.md

Guidance for agents working in this repo. Read this before changing code.

## What this is

`opencode-session-cycler` — an OpenCode TUI plugin (npm) providing session
cycling keybinds (`alt+j` / `alt+k` / `<leader>o`) and a collapsible
**Sessions (N)** sidebar widget (`<leader>s`). Ships as compiled JS via
`exports["./tui"]`; released through `.github/workflows/release.yml`.

## Commands

```sh
bun run lint        # eslint (flat config, typescript-eslint recommended)
bun run typecheck   # tsc --noEmit
bun test            # bun test with coverage thresholds from bunfig.toml
bun run build       # dist/index.js — externals + NODE_ENV=production define
```

All four must pass before committing. CI runs the same set.

## Architecture

Two-layer split — keep it:

- **Pure core** (`src/cycle.ts`, `src/widget.ts`): all navigation logic and
  widget computation. Zero OpenCode/solid imports; side effects injected as
  function arguments (`statusOf`, `messagesOf`, timer functions). This is what
  makes the logic unit-testable — put new logic here, not in the view.
- **IO shells**: `src/index.ts` (plugin wiring: keymap layer, toasts,
  registration order) and `src/sidebar.tsx` (Solid view + slot registration).
  Shells stay thin; branching logic belongs in the core.

Shared state lives at plugin scope (`createSidebarStore`,
`createSidebarData`), never per component mount — the host re-invokes slot
renderers freely, so per-mount state flickers or resets.

## Packaging gotchas (each one bit us once)

- `exports["./tui"]` is mandatory. The TUI loader does NOT fall back to
  `"main"`; a missing export is silently skipped. Guarded by a regression test.
- JSX compiles via tsconfig (`jsx: "react-jsx"`, `jsxImportSource:
  "@opentui/solid"`). The build must externalize `@opentui/*`, `solid-js`,
  `@opencode-ai/plugin` (they ship as real deps; the host resolves them
  through the installed package's node_modules) and must define
  `NODE_ENV=production`, otherwise the dev JSX runtime ships.
- `solid-js` is pinned exactly (`1.9.12`) because `@opentui/solid` pins it as
  a peer dependency.

## Testing patterns

- Harness in `test/index.test.ts` (`makeHarness`) mocks the whole TUI api:
  route, kv map, event bus, slots registry, theme colors, session state,
  client. Boot the real plugin against it and drive registered commands.
- `test/preload.ts` (wired in `bunfig.toml`) stubs
  `@opentui/solid/jsx-runtime`: components render headlessly into plain
  `{ $$el, type, props }` objects with REAL solid reactivity. Assert on
  rendered strings/colors by walking the tree (`allStrings`, `textEls`).
- Debounce timing: inject fake timers (`createDebouncer(wait, timers)`); for
  event-driven refetch tests use `settleDebounce()` (~150 ms real sleep).
- Coverage thresholds live in `bunfig.toml` (lines 100%, functions 85%).

## Conventions

- `_`-prefixed params/vars are intentionally unused (eslint is configured for
  this). Non-null assertions are allowed in tests, avoided in src.
- Default bindings: `alt+j` / `alt+k` / `<leader>o` / `alt+s`. Never bind
  `ctrl+left`/`ctrl+right` (core owns them inside the prompt input) or `<leader>s` (core status_view).
- User-facing strings: toasts are short lowercase-ish sentences ("No other
  sessions"); widget labels are exact per README ("Sessions (N)").
- Releases: don't bump versions by hand — use the Release workflow (see
  README "Releasing"). npm trusted publishing, no tokens in repo.
