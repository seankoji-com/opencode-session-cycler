---
name: code-review
description: Review priorities for opencode-session-cycler pull requests — what deserves real scrutiny versus what to skip in this OpenCode TUI plugin. Use for every PR review.
---

# Review priorities

## Spend real attention here

- **`package.json` `exports` map and the `build` script** (externals list, `NODE_ENV=production` define). OpenCode's TUI loader resolves plugins *only* through `exports["./tui"]` — it does not fall back to `main`, and a missing or wrong entry fails silently (plugin just never loads, no error). This exact bug shipped once (#10, fixed in v0.1.4) and is now guarded by a regression test in `test/index.test.ts`; check that packaging edits don't route around it.
- **Default keybindings** (`src/index.ts` keymap registration, README bindings table). OpenCode core owns `ctrl+left`/`ctrl+right` (prompt-input word nav) and `<leader>s` (status_view) — a plugin default colliding with those is consumed before the plugin sees it. Shipped once as `ctrl+left`/`ctrl+right` (#2) and reverted to `alt+j`/`alt+k` (#7). Flag any new default binding that isn't obviously free.
- **Logic added to `src/index.ts` or `src/sidebar.tsx` instead of `src/cycle.ts`/`src/widget.ts`.** The repo's testing strategy (see AGENTS.md "Architecture") depends on navigation/widget logic staying pure and side-effect-free in the core files, with IO shells kept thin. Branching or state logic landing in the shells is untested by construction.
- **`.github/workflows/release.yml`.** Repeatedly patched: PR-based flow to dodge a CodeQL-blocked direct push (#4), optional `RELEASE_PAT` to skip the bot-PR approval gate (#6), and an admin-bypass merge replacing a 15-minute `mergeStateStatus` poll once branch protection made `CLEAN` unreachable (#14). Treat further changes here as high-risk.

## Do not spend attention here

- `docs/assets/` — binary images (e.g. `social-preview.jpg`), nothing to review.
- Prose-only edits to `README.md` / `AGENTS.md`.
- `chore(ci): sync caller templates from seankoji-com/.github` PRs — opened by `seankoji-com-ci[bot]`, mechanically synced from the org's central `.github` repo; the source of truth lives there, not here.
- Formatting/lint-shape nits already enforced by `eslint.config.mjs` (typescript-eslint recommended) and `tsc --noEmit` — both already gate CI.

## Comment style

- One comment per real issue, not one per file it repeats in.
- Skip restating what CI or lint already flags.
