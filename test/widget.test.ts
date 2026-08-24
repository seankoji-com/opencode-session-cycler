import { describe, expect, test } from "bun:test"
import {
  CELL_WIDTH,
  KV_COLLAPSED_KEY,
  buildRows,
  cell,
  createDebouncer,
  headerLabel,
  isFailedMessage,
  messageText,
  newestMessage,
  sessionEmoji,
  statusEmoji,
  type PreviewMessage,
  type PreviewPart,
} from "../src/widget"
import type { CyclerSession } from "../src/cycle"

const s = (id: string, updated: number, extra: Partial<CyclerSession> = {}): CyclerSession => ({
  id,
  title: `title-${id}`,
  time: { updated },
  ...extra,
})

const msg = (id: string, created: number, extra: Partial<PreviewMessage> = {}): PreviewMessage => ({
  id,
  role: "user",
  time: { created },
  ...extra,
})

describe("cell", () => {
  test("pads short text to exactly CELL_WIDTH", () => {
    expect(cell("abc")).toBe(`abc${" ".repeat(CELL_WIDTH - 3)}`)
    expect(cell("").length).toBe(CELL_WIDTH)
    expect(cell(undefined)).toBe(" ".repeat(CELL_WIDTH))
  })

  test("truncates long text to CELL_WIDTH", () => {
    expect(cell("abcdefghijk")).toBe("abcdefghij")
    expect(cell("0123456789")).toHaveLength(10)
  })

  test("collapses whitespace before measuring", () => {
    expect(cell("a\n\t b  c")).toBe(`a b c${" ".repeat(CELL_WIDTH - 5)}`)
    expect(cell("  padded  ")).toBe(`padded${" ".repeat(CELL_WIDTH - 6)}`)
  })

  test("custom width", () => {
    expect(cell("abcdef", 3)).toBe("abc")
    expect(cell("ab", 4)).toBe("ab  ")
  })
})

describe("statusEmoji", () => {
  test("busy -> hourglass", () => {
    expect(statusEmoji("busy")).toBe("⏳")
  })
  test("retry -> warning", () => {
    expect(statusEmoji("retry")).toBe("⚠️")
  })
  test("idle -> check", () => {
    expect(statusEmoji("idle")).toBe("✅")
  })
  test("unknown/undefined -> check (waiting)", () => {
    expect(statusEmoji(undefined)).toBe("✅")
  })
})

describe("isFailedMessage", () => {
  test("assistant message with error payload", () => {
    expect(isFailedMessage({ role: "assistant", error: { name: "UnknownError" } })).toBe(true)
  })
  test("assistant message without error", () => {
    expect(isFailedMessage({ role: "assistant" })).toBe(false)
  })
  test("error on a user message never counts", () => {
    expect(isFailedMessage({ role: "user", error: { name: "x" } })).toBe(false)
  })
  test("undefined message", () => {
    expect(isFailedMessage(undefined)).toBe(false)
  })
})

describe("newestMessage", () => {
  test("picks highest time.created regardless of order", () => {
    const picked = newestMessage([msg("old", 1), msg("new", 50), msg("mid", 10)])
    expect(picked?.id).toBe("new")
  })

  test("ties resolve to the later array entry", () => {
    const picked = newestMessage([msg("first", 5), msg("second", 5)])
    expect(picked?.id).toBe("second")
  })

  test("missing timestamps sort as oldest", () => {
    const picked = newestMessage([{ id: "no-time" }, msg("timed", 1)])
    expect(picked?.id).toBe("timed")
  })

  test("empty list", () => {
    expect(newestMessage([])).toBeUndefined()
  })
})

const noParts = (): ReadonlyArray<PreviewPart> => []

describe("messageText", () => {
  test("joins multiple text parts", () => {
    const parts: PreviewPart[] = [
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ]
    expect(messageText(msg("m", 1), () => parts)).toBe("hello world")
  })

  test("skips synthetic and ignored parts and non-text parts", () => {
    const parts: PreviewPart[] = [
      { type: "text", text: "keep" },
      { type: "text", text: "meta", synthetic: true },
      { type: "text", text: "hidden", ignored: true },
      { type: "reasoning", text: "thinking out loud" },
    ]
    expect(messageText(msg("m", 1), () => parts)).toBe("keep")
  })

  test("collapses whitespace inside the text", () => {
    const parts: PreviewPart[] = [{ type: "text", text: "line1\n\nline2\ttab" }]
    expect(messageText(msg("m", 1), () => parts)).toBe("line1 line2 tab")
  })

  test("falls back to summary title then body", () => {
    expect(messageText({ id: "m", summary: { title: "Sum title" } }, noParts)).toBe("Sum title")
    expect(messageText({ id: "m", summary: { body: "Sum body" } }, noParts)).toBe("Sum body")
    expect(messageText({ id: "m", summary: { title: "", body: "" } }, noParts)).toBe("")
  })

  test("assistant boolean summary is ignored, not stringified", () => {
    expect(messageText({ id: "m", role: "assistant", summary: true }, noParts)).toBe("")
  })

  test("no parts and no summary -> empty string", () => {
    expect(messageText(msg("m", 1), noParts)).toBe("")
  })

  test("message without id cannot look up parts", () => {
    expect(messageText({ role: "user" }, () => [{ type: "text", text: "unreachable" }])).toBe("")
  })
})

describe("sessionEmoji precedence", () => {
  test("busy wins over everything", () => {
    const failed: PreviewMessage[] = [msg("m", 1, { role: "assistant", error: {} })]
    expect(sessionEmoji("busy", failed)).toBe("⏳")
    expect(sessionEmoji("busy", [])).toBe("⏳")
  })

  test("retry beats a past assistant error", () => {
    const failed: PreviewMessage[] = [msg("m", 1, { role: "assistant", error: {} })]
    expect(sessionEmoji("retry", failed)).toBe("⚠️")
  })

  test("latest failed assistant turn marks error while idle", () => {
    const messages: PreviewMessage[] = [
      msg("ok", 1, { role: "assistant" }),
      msg("boom", 2, { role: "assistant", error: { name: "ApiError" } }),
    ]
    expect(sessionEmoji("idle", messages)).toBe("⚠️")
  })

  test("an old error followed by a clean turn is waiting", () => {
    const messages: PreviewMessage[] = [
      msg("boom", 1, { role: "assistant", error: { name: "ApiError" } }),
      msg("ok", 2, { role: "assistant" }),
    ]
    expect(sessionEmoji("idle", messages)).toBe("✅")
  })

  test("no messages at all -> waiting", () => {
    expect(sessionEmoji("idle", [])).toBe("✅")
    expect(sessionEmoji(undefined, [])).toBe("✅")
  })
})

describe("buildRows", () => {
  const baseInput = {
    currentID: undefined as string | undefined,
    statusOf: (_: string) => "idle" as const,
    messagesOf: (_: string): ReadonlyArray<PreviewMessage> => [],
    partsFor: (_: string): ReadonlyArray<PreviewPart> => [],
  }

  test("one row per session, aligned cells, current flagged", () => {
    const sessions = [s("a", 2, { title: "alpha" }), s("b", 1, { title: "beta-longer-title-here" })]
    const rows = buildRows({ ...baseInput, sessions, currentID: "b" })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: "a", emoji: "✅", title: `alpha${" ".repeat(5)}`, isCurrent: false })
    expect(rows[1]?.isCurrent).toBe(true)
    expect(rows[1]?.title).toBe("beta-longe")
  })

  test("status and preview are pulled per session", () => {
    const sessions = [s("busy-one", 2), s("quiet", 1)]
    const rows = buildRows({
      ...baseInput,
      sessions,
      statusOf: (id) => (id === "busy-one" ? "busy" : undefined),
      messagesOf: (id) => (id === "quiet" ? [msg("m1", 5)] : []),
      partsFor: () => [{ type: "text", text: "latest words" }],
    })
    expect(rows[0]?.emoji).toBe("⏳")
    expect(rows[1]?.emoji).toBe("✅")
    expect(rows[1]?.preview).toBe("latest wor")
  })

  test("empty title falls back to the session id", () => {
    const rows = buildRows({
      ...baseInput,
      sessions: [s("sess-abcdefgh", 1, { title: "   " })],
    })
    expect(rows[0]?.title).toBe("sess-abcde")
  })

  test("empty list renders zero rows", () => {
    expect(buildRows({ ...baseInput, sessions: [] })).toEqual([])
  })
})

describe("headerLabel", () => {
  test("embeds the count", () => {
    expect(headerLabel(0)).toBe("Sessions (0)")
    expect(headerLabel(7)).toBe("Sessions (7)")
  })
})

describe("createDebouncer", () => {
  const fakeTimers = () => {
    let now = 0
    const pending = new Map<number, { at: number; fn: () => void }>()
    let nextId = 1
    return {
      setTimeout(fn: () => void, ms: number) {
        const id = nextId++
        pending.set(id, { at: now + ms, fn })
        return id
      },
      clearTimeout(id: unknown) {
        pending.delete(id as number)
      },
      advance(ms: number) {
        now += ms
        for (const [id, p] of [...pending]) {
          if (p.at <= now) {
            pending.delete(id)
            p.fn()
          }
        }
      },
      get pendingCount() {
        return pending.size
      },
    }
  }

  test("collapses a burst into one trailing call", () => {
    const t = fakeTimers()
    const d = createDebouncer(100, t)
    let calls = 0
    d.run(() => calls++)
    d.run(() => calls++)
    d.run(() => calls++)
    t.advance(50)
    expect(calls).toBe(0)
    t.advance(50)
    expect(calls).toBe(1)
  })

  test("cancel drops the pending call entirely", () => {
    const t = fakeTimers()
    const d = createDebouncer(100, t)
    let calls = 0
    d.run(() => calls++)
    d.cancel()
    expect(t.pendingCount).toBe(0)
    t.advance(500)
    expect(calls).toBe(0)
  })

  test("uses injected timers, not real ones", () => {
    const t = fakeTimers()
    createDebouncer(100, t).run(() => {})
    expect(t.pendingCount).toBe(1)
  })
})

describe("kv key", () => {
  test("stable identifier", () => {
    expect(KV_COLLAPSED_KEY).toBe("sidebar.collapsed")
  })
})
