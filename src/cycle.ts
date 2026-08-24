/**
 * Pure navigation logic for opencode-session-cycler.
 *
 * Kept free of any OpenCode imports so it can be unit-tested directly.
 */

export type CyclerSession = {
  id: string
  parentID?: string
  projectID?: string
  title?: string
  time?: {
    created?: number
    updated?: number
  }
}

/**
 * Build the cycle order from a raw session list:
 *
 * - child (subagent) sessions are excluded
 * - when an anchor project is known, sessions are scoped to that project;
 *   if that scope is empty we fall back to all top-level sessions
 * - result is sorted most-recently-updated first
 */
export function cycleList(sessions: CyclerSession[], anchorProjectID?: string): CyclerSession[] {
  const roots = sessions.filter((s) => !s.parentID)
  const scoped = anchorProjectID ? roots.filter((s) => s.projectID === anchorProjectID) : []
  const pool = scoped.length > 0 ? scoped : roots
  return [...pool].sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
}

/**
 * Index in `list` we land on when stepping `delta` from `currentID`.
 *
 * - empty list        -> -1 (nothing to do)
 * - unknown current   -> 0  (e.g. sitting on home; go to most recent)
 * - otherwise         -> wrap-around step
 */
export function stepIndex(list: CyclerSession[], currentID: string | undefined, delta: 1 | -1): number {
  if (list.length === 0) return -1
  const idx = currentID ? list.findIndex((s) => s.id === currentID) : -1
  if (idx === -1) return 0
  return (idx + delta + list.length) % list.length
}

/**
 * Tracks the "previous session" for toggle-last, without subscribing to any
 * event bus. Reconciles lazily at keybind time:
 *
 * - each command calls `observe(actual)` with the session currently on screen
 * - if reality differs from what we last saw, the user navigated externally
 *   (session dialog, quick slot, CLI flag); the stale observation becomes the
 *   new "last"
 * - programmatic jumps call `landed(from, to)` to keep the pointer honest
 *
 * State is intentionally ephemeral — it resets on TUI restart, matching the
 * semantics proposed in anomalyco/opencode#9526.
 */
export class LastSessionTracker {
  private last?: string
  private seen?: string

  observe(actual: string | undefined): string | undefined {
    if (actual !== this.seen) {
      if (this.seen !== undefined) {
        this.last = this.seen
      }
      this.seen = actual
    }
    return this.last
  }

  landed(from: string | undefined, to: string): void {
    this.last = from
    this.seen = to
  }
}
