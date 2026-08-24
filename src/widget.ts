/**
 * Pure logic for the session sidebar widget.
 *
 * Kept free of any OpenCode / solid imports so it can be unit-tested directly.
 */

import type { CyclerSession } from "./cycle"

/** Number of characters shown for the title and preview columns. */
export const CELL_WIDTH = 10

/** api.kv key persisting the collapsed/expanded state across restarts. */
export const KV_COLLAPSED_KEY = "sidebar.collapsed"

/** Minimal shape of the SDK SessionStatus union we care about. */
export type WidgetStatus = "idle" | "busy" | "retry" | undefined

/** A message-like shape: only what preview extraction needs. */
export type PreviewMessage = {
  id?: string
  role?: string
  time?: { created?: number }
  error?: unknown
  /** UserMessage carries {title?,body?}; AssistantMessage carries boolean. */
  summary?: unknown
}

/** A text part-like shape: only what preview extraction needs. */
export type PreviewPart = {
  type?: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
}

export type SidebarRow = {
  id: string
  emoji: string
  title: string
  preview: string
  isCurrent: boolean
}

/**
 * Slice `text` to `width` characters and pad with spaces to exactly `width`,
 * so title / preview columns line up in the terminal's monospace grid.
 *
 * Empty/undefined text becomes all spaces (keeps rows aligned).
 */
export function cell(text: string | undefined, width = CELL_WIDTH): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim()
  if (clean.length >= width) return clean.slice(0, width)
  return clean + " ".repeat(width - clean.length)
}

/**
 * Map a session status to its sidebar emoji.
 *
 * - busy   -> ⏳ (turn in progress)
 * - retry  -> ⚠️ (provider retrying after an error)
 * - idle / unknown -> ✅ (waiting)
 */
export function statusEmoji(status: WidgetStatus): string {
  if (status === "busy") return "⏳"
  if (status === "retry") return "⚠️"
  return "✅"
}

/**
 * True when a message looks like a failed assistant turn (carries an `error`
 * payload). Tolerates any error shape — presence is what matters.
 */
export function isFailedMessage(message: PreviewMessage | undefined): boolean {
  if (!message || message.role !== "assistant") return false
  return message.error != null
}

/**
 * Pick the newest message by creation time (defensive: the host normally
 * returns messages chronologically, but ordering is not contractual).
 */
export function newestMessage(messages: ReadonlyArray<PreviewMessage>): PreviewMessage | undefined {
  let best: PreviewMessage | undefined
  let bestTime = -1
  for (const m of messages) {
    const t = m.time?.created ?? 0
    if (t >= bestTime) {
      bestTime = t
      best = m
    }
  }
  return best
}

/** Pull human-readable text out of a message's `summary` field, which is a
 * {title?,body?} object on user messages and a boolean on assistant ones. */
function summaryText(summary: unknown): string {
  if (!summary || typeof summary !== "object") return ""
  const s = summary as { title?: unknown; body?: unknown }
  if (typeof s.title === "string" && s.title.trim().length > 0) return s.title.trim()
  if (typeof s.body === "string" && s.body.trim().length > 0) return s.body.trim()
  return ""
}

/**
 * Extract displayable text for one message: concatenated non-synthetic,
 * non-ignored text parts, falling back to a compaction summary title/body.
 * Returns "" when nothing human-readable exists yet.
 */
export function messageText(message: PreviewMessage, partsFor: (messageID: string) => ReadonlyArray<PreviewPart>): string {
  const parts = message.id ? partsFor(message.id) : []
  const text = parts
    .filter((p) => p.type === "text" && !p.synthetic && !p.ignored && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  if (text.length > 0) return text
  return summaryText(message.summary)
}

/**
 * Status emoji for a whole session: busy wins over past errors, then explicit
 * retry, then the most recent failed assistant turn, else waiting.
 */
export function sessionEmoji(
  status: WidgetStatus,
  messages: ReadonlyArray<PreviewMessage>,
): string {
  if (status === "busy") return "⏳"
  if (status === "retry") return "⚠️"
  if (isFailedMessage(newestMessage(messages))) return "⚠️"
  return "✅"
}

export type RowInput = {
  sessions: ReadonlyArray<CyclerSession>
  currentID: string | undefined
  /** Status lookup per session id (host state; may be undefined). */
  statusOf: (sessionID: string) => WidgetStatus
  /** Message list lookup per session id. */
  messagesOf: (sessionID: string) => ReadonlyArray<PreviewMessage>
  /** Text-part lookup per message id. */
  partsFor: (messageID: string) => ReadonlyArray<PreviewPart>
}

/**
 * Build the rendered rows for the widget from an already-scoped, already-sorted
 * session list (i.e. the output of `cycleList`).
 */
export function buildRows(input: RowInput): SidebarRow[] {
  return input.sessions.map((s) => {
    const messages = input.messagesOf(s.id)
    const rawTitle = s.title && s.title.trim().length > 0 ? s.title : s.id.slice(0, CELL_WIDTH)
    const latest = newestMessage(messages)
    const preview = latest ? messageText(latest, input.partsFor) : ""
    return {
      id: s.id,
      emoji: sessionEmoji(input.statusOf(s.id), messages),
      title: cell(rawTitle),
      preview: cell(preview),
      isCurrent: s.id === input.currentID,
    }
  })
}

/** Header label: `Sessions (N)` with N = number of listed sessions. */
export function headerLabel(count: number): string {
  return `Sessions (${count})`
}

/** Minimal timer surface so tests can inject deterministic fakes. */
export type DebounceTimers = {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/**
 * Trailing-edge debounce that returns a cancel handle. Injected timer
 * functions keep this deterministic under test.
 */
export function createDebouncer(
  waitMs: number,
  timers?: DebounceTimers,
): { run: (fn: () => void) => void; cancel: () => void } {
  const t: DebounceTimers =
    timers ??
    // Default to real timers; casts bridge the ambient DOM/node typings.
    {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as number),
    }
  let handle: unknown
  return {
    run(fn: () => void) {
      if (handle !== undefined) t.clearTimeout(handle)
      handle = t.setTimeout(() => {
        handle = undefined
        fn()
      }, waitMs)
    },
    cancel() {
      if (handle !== undefined) {
        t.clearTimeout(handle)
        handle = undefined
      }
    },
  }
}
