import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import plugin from "../src/index"
import type { CyclerSession } from "../src/cycle"
import { KV_COLLAPSED_KEY, cell } from "../src/widget"
import pkg from "../package.json"

const s = (id: string, updated: number, extra: Partial<CyclerSession> = {}): CyclerSession => ({
  id,
  title: `title-${id}`,
  time: { updated },
  ...extra,
})

type Route =
  | { name: "home" }
  | { name: "session"; params: { sessionID: string } }

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const settleDebounce = () => new Promise<void>((resolve) => setTimeout(resolve, 150))

/**
 * Boots the real plugin against a mock TUI api and returns handles to drive
 * the registered commands and inspect what the plugin did.
 */
async function makeHarness(
  init: {
    sessions?: CyclerSession[]
    route?: Route
    /** Pre-seed api.kv contents. */
    kv?: Record<string, unknown>
    /** Omit the slots API entirely (simulates an older host). */
    omitSlots?: boolean
  } = {},
  options?: Parameters<typeof plugin.tui>[1],
) {
  const state = {
    sessions: init.sessions ?? [],
    route: init.route ?? ({ name: "home" } as Route),
    statuses: {} as Record<string, string | undefined>,
    messages: {} as Record<string, Array<{ id: string; role: string; time?: { created?: number }; error?: unknown }>>,
    parts: {} as Record<string, Array<{ type: string; text?: string; synthetic?: boolean; ignored?: boolean }>>,
    theme: {
      text: { r: 1, g: 1, b: 1, a: 1 },
      textMuted: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
      selectedListItemText: { r: 0, g: 0, b: 0, a: 1 },
    },
  }
  const toasts: string[] = []
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> = []
  let dialogClears = 0
  const commands = new Map<string, () => void>()
  let layer: { mode: string; commands: unknown[]; bindings: Array<{ key: string; cmd: string }> } | undefined

  // kv / events / slots mocks -------------------------------------------------
  const kvStore = new Map<string, unknown>(Object.entries(init.kv ?? {}))
  const eventHandlers = new Map<string, Array<(event: unknown) => void>>()
  const slotRegistrations: Array<{
    order?: number
    slots: Record<string, (ctx: unknown, props: Record<string, unknown>) => unknown>
  }> = []
  let listCalls = 0

  const api = {
    route: {
      get current() {
        return state.route
      },
      navigate(name: string, params?: Record<string, unknown>) {
        navigations.push({ name, params })
      },
      register: () => () => {},
    },
    ui: {
      toast(input: { message: string }) {
        toasts.push(input.message)
      },
      dialog: {
        clear() {
          dialogClears++
        },
      },
    },
    theme: {
      get current() {
        return state.theme
      },
    },
    kv: {
      get(key: string, fallback?: unknown) {
        return kvStore.has(key) ? kvStore.get(key) : fallback
      },
      set(key: string, value: unknown) {
        kvStore.set(key, value)
      },
      ready: true,
    },
    event: {
      on(type: string, handler: (event: unknown) => void) {
        const list = eventHandlers.get(type) ?? []
        list.push(handler)
        eventHandlers.set(type, list)
        return () => {
          eventHandlers.set(
            type,
            (eventHandlers.get(type) ?? []).filter((h) => h !== handler),
          )
        }
      },
    },
    slots: init.omitSlots
      ? undefined
      : {
          register(registration: (typeof slotRegistrations)[number]) {
            slotRegistrations.push(registration)
            return `${registration.order ?? 0}:test`
          },
        },
    state: {
      session: {
        get: (sessionID: string) => state.sessions.find((x) => x.id === sessionID),
        status: (sessionID: string) =>
          state.statuses[sessionID] === undefined ? undefined : { type: state.statuses[sessionID] },
        messages: (sessionID: string) => state.messages[sessionID] ?? [],
      },
      part: (messageID: string) => state.parts[messageID] ?? [],
    },
    client: {
      session: {
        list: async () => {
          listCalls++
          return { data: state.sessions }
        },
      },
    },
    keymap: {
      registerLayer(registered: NonNullable<typeof layer>) {
        layer = registered
        for (const c of registered.commands as Array<{ name: string; run: () => void }>) {
          commands.set(c.name, c.run)
        }
        return {}
      },
    },
  }

  await plugin.tui(api as unknown as TuiPluginApi, options, {} as never)

  const run = (name: string) => {
    const fn = commands.get(`session_cycler.${name}`)
    if (!fn) throw new Error(`command not registered: ${name}`)
    fn()
  }

  /** Fire all handlers registered for an event type. */
  const emit = (type: string, event: unknown = {}) => {
    for (const h of eventHandlers.get(type) ?? []) h(event)
  }

  const client = api.client as { session: { list(): Promise<{ data: CyclerSession[] }> } }

  return {
    run,
    emit,
    client,
    toasts,
    navigations,
    get dialogClears() {
      return dialogClears
    },
    get bindings() {
      return layer?.bindings ?? []
    },
    get slotRegistrations() {
      return slotRegistrations
    },
    get listCalls() {
      return listCalls
    },
    get kvStore() {
      return kvStore
    },
    state,
  }
}

describe("registration", () => {
  test("package exposes a ./tui entrypoint (OpenCode loads TUI plugins via exports)", () => {
    // OpenCode's TUI plugin loader resolves npm plugins via
    // package.json exports["./tui"] and does NOT fall back to "main".
    // A plugin without that export is silently skipped.
    const exportsMap = (pkg as { exports?: Record<string, unknown> }).exports
    expect(exportsMap).toBeDefined()
    expect(exportsMap?.["./tui"]).toBe("./dist/index.js")
    expect(exportsMap?.["."]).toBe("./dist/index.js")
  })

  test("registers next / previous / last / sidebar commands in order", async () => {
    const h = await makeHarness()
    expect(h.bindings.map((b) => b.cmd)).toEqual([
      "session_cycler.next",
      "session_cycler.previous",
      "session_cycler.last",
      "session_cycler.sidebar",
    ])
    // every command is bound to a non-empty, distinct key
    const keys = h.bindings.map((b) => b.key)
    for (const key of keys) expect(key.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(4)
  })

  test("default sidebar binding is alt+s (core owns <leader>s for status_view)", async () => {
    const h = await makeHarness()
    expect(h.bindings.at(-1)?.key).toBe("alt+s")
  })

  test("custom bindings override defaults individually", async () => {
    const base = await makeHarness()
    const custom = await makeHarness({}, { bindings: { next: "alt+x", sidebar: "<leader>S" } })
    expect(custom.bindings[0]!.key).toBe("alt+x")
    expect(custom.bindings[1]!.key).toBe(base.bindings[1]!.key)
    expect(custom.bindings[2]!.key).toBe(base.bindings[2]!.key)
    expect(custom.bindings[3]!.key).toBe("<leader>S")
  })
})

describe("next / previous navigation", () => {
  test("from home, next lands on the most recent session", async () => {
    const h = await makeHarness({ sessions: [s("a", 100), s("b", 300)] })
    h.run("next")
    await flush()
    expect(h.navigations).toEqual([{ name: "session", params: { sessionID: "b" } }])
    expect(h.toasts).toEqual(["title-b"])
    expect(h.dialogClears).toBe(1)
  })

  test("next cycles forward with wrap-around", async () => {
    const h = await makeHarness({
      sessions: [s("a", 3), s("b", 2), s("c", 1)],
      route: { name: "session", params: { sessionID: "c" } },
    })
    h.run("next")
    await flush()
    expect(h.navigations[0]!.params).toEqual({ sessionID: "a" })
    h.state.route = { name: "session", params: { sessionID: "a" } }
    h.run("next")
    await flush()
    expect(h.navigations[1]!.params).toEqual({ sessionID: "b" })
  })

  test("previous cycles backward", async () => {
    const h = await makeHarness({
      sessions: [s("a", 3), s("b", 2)],
      route: { name: "session", params: { sessionID: "b" } },
    })
    h.run("previous")
    await flush()
    expect(h.navigations[0]!.params).toEqual({ sessionID: "a" })
  })

  test("cycling is scoped to the current project and falls back when the scope is empty elsewhere", async () => {
    const sessions = [
      s("p1-old", 100, { projectID: "p1" }),
      s("p1-newer", 200, { projectID: "p1" }),
      s("p2-newest", 900, { projectID: "p2" }),
    ]
    const h = await makeHarness({
      sessions,
      route: { name: "session", params: { sessionID: "p1-newer" } },
    })
    h.run("next")
    await flush()
    expect(h.navigations[0]!.params).toEqual({ sessionID: "p1-old" })
  })

  test("no sessions at all just toasts", async () => {
    const h = await makeHarness()
    h.run("next")
    await flush()
    expect(h.navigations).toEqual([])
    expect(h.toasts).toEqual(["No sessions yet"])
  })

  test("stepping onto yourself is a no-op (single-session wrap)", async () => {
    const h = await makeHarness({
      sessions: [s("only", 1)],
      route: { name: "session", params: { sessionID: "only" } },
    })
    h.run("next")
    await flush()
    expect(h.navigations).toEqual([])
    expect(h.toasts).toEqual(["No other sessions"])
  })
})

describe("toggle last", () => {
  test("returns to the previously visited session", async () => {
    const h = await makeHarness({ sessions: [s("a", 2), s("b", 1)] })
    h.run("next") // home -> a (most recent)
    await flush()
    expect(h.navigations[0]!.params).toEqual({ sessionID: "a" })
    h.state.route = { name: "session", params: { sessionID: "a" } }
    h.run("next") // a -> b (wrap)
    await flush()
    expect(h.navigations[1]!.params).toEqual({ sessionID: "b" })
    h.state.route = { name: "session", params: { sessionID: "b" } }
    h.run("last") // b -> back to a
    await flush()
    expect(h.navigations[2]!.params).toEqual({ sessionID: "a" })
  })

  test("no previous session on first use", async () => {
    const h = await makeHarness({
      sessions: [s("a", 1)],
      route: { name: "session", params: { sessionID: "a" } },
    })
    h.run("last")
    await flush()
    expect(h.navigations).toEqual([])
    expect(h.toasts).toEqual(["No previous session"])
  })

  test("previous session vanished from the server", async () => {
    const h = await makeHarness({ sessions: [s("a", 2), s("b", 1)] })
    h.run("next") // home -> a
    await flush()
    h.state.route = { name: "session", params: { sessionID: "a" } }
    h.run("next") // a -> b, tracker now holds last=a
    await flush()
    h.state.route = { name: "session", params: { sessionID: "b" } }
    h.state.sessions = [s("b", 1)] // a deleted behind our back
    h.run("last")
    await flush()
    expect(h.navigations).toHaveLength(2)
    expect(h.toasts.at(-1)).toBe("Previous session is gone")
  })
})

describe("in-flight guard", () => {
  test("rapid double-press runs the cycle only once", async () => {
    const h = await makeHarness({ sessions: [s("a", 2), s("b", 1)] })
    h.run("next")
    h.run("next") // second press while first is still in flight
    await flush()
    expect(h.navigations).toHaveLength(1)
  })
})


const sidebarSlot = (h: Awaited<ReturnType<typeof makeHarness>>) =>
  h.slotRegistrations
    .flatMap((r) => Object.entries(r.slots))
    .find(([name]) => name === "sidebar_content")?.[1]

const mountView = async (h: Awaited<ReturnType<typeof makeHarness>>) => {
  sidebarSlot(h)!({}, { session_id: undefined })
  await flush()
}

describe("sidebar widget", () => {
  test("registers a sidebar_content slot with a stable order", async () => {
    const h = await makeHarness()
    expect(h.slotRegistrations).toHaveLength(1)
    expect(h.slotRegistrations[0]!.slots.sidebar_content).toBeFunction()
    expect(typeof h.slotRegistrations[0]!.order).toBe("number")
  })

  test("slot renders (returns an element) against host props", async () => {
    const h = await makeHarness({ sessions: [s("a", 1)] })
    const element = sidebarSlot(h)!({}, { session_id: "a" })
    expect(element).toBeDefined()
  })

  test("initial list fetch happens on mount of the view, not at boot", async () => {
    const h = await makeHarness({ sessions: [s("a", 1)] })
    expect(h.listCalls).toBe(0)
    await mountView(h)
    expect(h.listCalls).toBeGreaterThanOrEqual(1)
  })

  test("toggle command flips kv state and toasts feedback", async () => {
    const h = await makeHarness({ kv: { [KV_COLLAPSED_KEY]: true } })
    h.run("sidebar")
    expect(h.kvStore.get(KV_COLLAPSED_KEY)).toBe(false)
    expect(h.toasts.at(-1)).toBe("Sessions shown")

    h.run("sidebar")
    expect(h.kvStore.get(KV_COLLAPSED_KEY)).toBe(true)
    expect(h.toasts.at(-1)).toBe("Sessions hidden")
  })

  test("toggle starts from expanded when kv has no entry", async () => {
    const h = await makeHarness()
    h.run("sidebar")
    expect(h.kvStore.get(KV_COLLAPSED_KEY)).toBe(true)
    expect(h.toasts.at(-1)).toBe("Sessions hidden")
  })

  test("missing slots API degrades to a toast, keybinds still work", async () => {
    const h = await makeHarness({ omitSlots: true, sessions: [s("a", 2), s("b", 1)] })
    expect(h.slotRegistrations).toHaveLength(0)

    h.run("sidebar")
    expect(h.toasts).toEqual(["Sidebar unavailable"])

    // the cycler itself is unaffected (home -> most recent session)
    h.run("next")
    await flush()
    expect(h.navigations).toEqual([{ name: "session", params: { sessionID: "a" } }])
  })

  test("session events are subscribed for list refresh", async () => {
    const h = await makeHarness({ sessions: [s("a", 1)] })
    await mountView(h)
    const callsAfterMount = h.listCalls

    h.emit("session.updated", { properties: {} })
    h.emit("session.created", { properties: {} })
    h.emit("session.deleted", { properties: {} })
    await settleDebounce()

    expect(h.listCalls).toBeGreaterThan(callsAfterMount)
  })

  test("bursty events coalesce into one refetch", async () => {
    const h = await makeHarness({ sessions: [s("a", 1)] })
    await mountView(h)
    const before = h.listCalls

    for (let i = 0; i < 5; i++) h.emit("session.updated", { properties: {} })
    await settleDebounce()

    expect(h.listCalls).toBe(before + 1)
  })

  test("unrelated events do not trigger a refetch", async () => {
    const h = await makeHarness({ sessions: [s("a", 1)] })
    await mountView(h)
    const before = h.listCalls

    h.emit("lsp.updated", { properties: {} })
    h.emit("installation.updated", { properties: {} })
    await settleDebounce()

    expect(h.listCalls).toBe(before)
  })

  test("refetch failure keeps the previous list (no throw)", async () => {
    const h = await makeHarness({ sessions: [s("a", 1)] })
    await mountView(h)

    ;(h.client.session as { list: () => Promise<unknown> }).list = () =>
      Promise.reject(new Error("server restarting"))

    h.emit("session.updated", { properties: {} })
    await settleDebounce()
    // reaching here without an unhandled rejection is the assertion
  })
})

describe("sidebar rendering", () => {
  type FakeEl = { $$el: true; type: unknown; props: Record<string, unknown> }
  const isFakeEl = (v: unknown): v is FakeEl =>
    typeof v === "object" && v !== null && (v as FakeEl).$$el === true

  /** Every string in the rendered tree, in document order. */
  const allStrings = (node: unknown): string[] => {
    const out: string[] = []
    const walk = (n: unknown) => {
      if (typeof n === "string") return void out.push(n)
      if (Array.isArray(n)) return n.forEach(walk)
      if (isFakeEl(n)) walk(n.props.children)
    }
    walk(node)
    return out
  }

  /** Intrinsic <text> elements carrying a direct string child. */
  const textEls = (node: unknown): Array<FakeEl & { props: { children: string; fg?: unknown } }> => {
    const out: Array<FakeEl & { props: { children: string; fg?: unknown } }> = []
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!isFakeEl(n)) return
      if (n.type === "text" && typeof n.props.children === "string") {
        out.push(n as FakeEl & { props: { children: string; fg?: unknown } })
      }
      walk(n.props.children)
    }
    walk(node)
    return out
  }

  const rowString = (emoji: string, title: string, preview: string) =>
    `${emoji} ${cell(title)} ${cell(preview)}`

  test("header shows Sessions (N); rows show emoji + padded title + padded preview", async () => {
    const h = await makeHarness({
      sessions: [s("a", 2, { title: "alpha" }), s("b", 1, { title: "beta session here" })],
    })
    h.state.messages["a"] = [{ id: "m1", role: "user", time: { created: 5 } }]
    h.state.parts["m1"] = [{ type: "text", text: "hello world and more" }]

    await mountView(h)
    await mountView(h)
    const strings = allStrings(sidebarSlot(h)!({}, { session_id: undefined }))

    expect(strings).toContain("Sessions (2)")
    expect(strings).toContain(rowString("✅", "alpha", "hello world and more"))
    expect(strings).toContain(rowString("✅", "beta sessi", ""))
  })

  test("status emojis: busy ⏳, retry ⚠️, latest-error ⚠️, idle ✅", async () => {
    const h = await makeHarness({
      sessions: [
        s("busy", 4),
        s("retrying", 3),
        s("errored", 2),
        s("calm", 1),
      ],
    })
    h.state.statuses["busy"] = "busy"
    h.state.statuses["retrying"] = "retry"
    h.state.messages["errored"] = [{ id: "e1", role: "assistant", time: { created: 1 }, error: { name: "ApiError" } }]

    await mountView(h)
    const strings = allStrings(sidebarSlot(h)!({}, { session_id: undefined }))
    expect(strings).toContain(rowString("⏳", "title-busy", ""))
    expect(strings).toContain(rowString("⚠️", "title-retryi", ""))
    expect(strings).toContain(rowString("⚠️", "title-erroe", ""))
    expect(strings).toContain(rowString("✅", "title-calm", ""))
  })

  test("current session is highlighted, others plain text", async () => {
    const h = await makeHarness({
      sessions: [s("a", 2), s("b", 1)],
      route: { name: "session", params: { sessionID: "b" } },
    })

    await mountView(h)
    const els = textEls(sidebarSlot(h)!({}, { session_id: "b" }))
    const currentRow = els.find((el) => el.props.children.startsWith("✅ title-b"))
    const otherRow = els.find((el) => el.props.children.startsWith("✅ title-a"))

    expect(currentRow?.props.fg).toBe(h.state.theme.selectedListItemText)
    expect(otherRow?.props.fg).toBe(h.state.theme.text)
  })

  test("collapsed store renders header only", async () => {
    const h = await makeHarness({
      sessions: [s("a", 2), s("b", 1)],
      kv: { [KV_COLLAPSED_KEY]: true },
    })

    await mountView(h)
    const collapsedStrings = allStrings(sidebarSlot(h)!({}, { session_id: undefined }))
    expect(collapsedStrings).toContain("Sessions (2)")
    expect(collapsedStrings).not.toContain(rowString("✅", "title-a", ""))

    // expanding via the shared store brings rows back
    h.run("sidebar")
    expect(h.kvStore.get(KV_COLLAPSED_KEY)).toBe(false)
    await mountView(h)
    const expandedStrings = allStrings(sidebarSlot(h)!({}, { session_id: undefined }))
    expect(expandedStrings).toContain(rowString("✅", "title-a", ""))
  })

  test("rows are scoped to the viewed project like the cycler keybinds", async () => {
    const h = await makeHarness({
      sessions: [
        s("p1-a", 3, { projectID: "p1" }),
        s("p2-b", 2, { projectID: "p2" }),
      ],
      route: { name: "session", params: { sessionID: "p1-a" } },
    })

    await mountView(h)
    const strings = allStrings(sidebarSlot(h)!({}, { session_id: "p1-a" }))
    expect(strings).toContain("Sessions (1)")
    expect(strings).toContain(rowString("✅", "title-p1-a", ""))
    expect(strings).not.toContain(rowString("✅", "title-p2-b", ""))
  })

  test("empty scope shows the no-sessions hint", async () => {
    const h = await makeHarness({ sessions: [] })
    await mountView(h)
    const strings = allStrings(sidebarSlot(h)!({}, { session_id: undefined }))
    expect(strings).toContain("Sessions (0)")
    expect(strings).toContain("no sessions")
  })

  test("subagent sessions never appear", async () => {
    const h = await makeHarness({
      sessions: [s("root", 2), s("child", 3, { parentID: "root" })],
    })
    await mountView(h)
    const strings = allStrings(sidebarSlot(h)!({}, { session_id: undefined }))
    expect(strings).toContain("Sessions (1)")
    expect(strings.join("\n")).not.toContain("title-child")
  })
})

type RouteV2 = { type: "home" } | { type: "session"; sessionID: string }

async function makeHarnessV2(
  init: {
    sessions?: CyclerSession[]
    route?: RouteV2
    collapsed?: boolean
    omitSlot?: boolean
    omitStorage?: boolean
    legacyTheme?: boolean
  } = {},
  options?: Parameters<typeof plugin.setup>[0] extends { options: infer O } ? O : unknown,
) {
  const state = {
    sessions: init.sessions ?? [],
    route: init.route ?? ({ type: "home" } as RouteV2),
    statuses: {} as Record<string, "idle" | "running">,
    messages: {} as Record<string, Array<{ id: string; type: string; time: { created: number }; text?: string; content?: unknown[]; error?: unknown }>>,
    collapsed: init.collapsed ?? false,
    theme: init.legacyTheme
      ? {
          current: {
            text: { r: 1, g: 1, b: 1, a: 1 },
            textMuted: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
            selectedListItemText: { r: 0, g: 0, b: 0, a: 1 },
          },
        }
      : {
          text: {
            base: { r: 1, g: 1, b: 1, a: 1 },
            muted: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
            action: { primary: { base: { r: 0, g: 1, b: 0, a: 1 } } },
          },
        },
  }
  const toasts: string[] = []
  const navigations: Array<{ type: string; sessionID?: string }> = []
  let dialogClears = 0
  const commands = new Map<string, () => void>()
  let layer: { mode?: string; commands?: Array<{ id?: string; bind?: string; run: () => void }> } | undefined
  const eventHandlers = new Map<string, Array<(event: unknown) => void>>()
  const slotClaims: Array<{ append?: string; render: (input: { sessionID?: string }) => unknown }> = []
  let listCalls = 0

  const context = {
    options: options ?? {},
    ui: {
      toast: {
        show(input: { message: string }) {
          toasts.push(input.message)
        },
      },
      dialog: {
        clear() {
          dialogClears++
        },
      },
      router: {
        current() {
          return state.route
        },
        navigate(dest: { type: string; sessionID?: string }) {
          navigations.push(dest)
        },
      },
      ...(init.omitSlot
        ? {}
        : {
            slot(claim: { append?: string; render: (input: { sessionID?: string }) => unknown }) {
              slotClaims.push(claim)
              return () => {}
            },
          }),
    },
    client: {
      session: {
        list: async () => {
          listCalls++
          return { data: state.sessions }
        },
      },
    },
    data: {
      session: {
        get(id: string) {
          return state.sessions.find((x) => x.id === id)
        },
        status(id: string) {
          return state.statuses[id] ?? "idle"
        },
        message: {
          list(id: string) {
            return state.messages[id] ?? []
          },
        },
      },
      on(type: string, handler: (event: unknown) => void) {
        const list = eventHandlers.get(type) ?? []
        list.push(handler)
        eventHandlers.set(type, list)
        return () => {}
      },
    },
    keymap: {
      layer(factory: () => typeof layer) {
        layer = factory()
        for (const cmd of layer?.commands ?? []) {
          if (cmd.id) commands.set(cmd.id, cmd.run)
        }
      },
    },
    ...(init.omitStorage
      ? {}
      : {
          storage: {
            store<T extends object>(_key: string, _opts: { initial: T }) {
              const s = { collapsed: state.collapsed }
              const mutate = async (fn: (draft: typeof s) => void) => {
                fn(s)
                state.collapsed = s.collapsed
              }
              return [s, mutate] as const
            },
          },
        }),
    theme: state.theme,
  }

  await plugin.setup(context as never)

  const run = (name: string) => {
    const fn = commands.get(`session_cycler.${name}`)
    if (!fn) throw new Error(`command not registered: ${name}`)
    fn()
  }

  const emit = (type: string, event: unknown = {}) => {
    for (const h of eventHandlers.get(type) ?? []) h(event)
  }

  return {
    run,
    emit,
    toasts,
    navigations,
    get dialogClears() {
      return dialogClears
    },
    get commands() {
      return layer?.commands ?? []
    },
    get slotClaims() {
      return slotClaims
    },
    get listCalls() {
      return listCalls
    },
    context,
    state,
  }
}

const sidebarSlotV2 = (h: Awaited<ReturnType<typeof makeHarnessV2>>) =>
  h.slotClaims[0]?.render

const mountViewV2 = async (h: Awaited<ReturnType<typeof makeHarnessV2>>) => {
  sidebarSlotV2(h)!({ sessionID: undefined })
  await flush()
}

describe("OpenCode 2.x (V2) contract & registration", () => {
  test("plugin module satisfies OpenCode 2.x V2 contract", () => {
    expect(plugin.id).toBe("opencode-session-cycler")
    expect(typeof plugin.setup).toBe("function")
    expect(typeof plugin.tui).toBe("function")
  })

  test("registers next / previous / last / sidebar commands via context.keymap.layer", async () => {
    const h = await makeHarnessV2()
    expect(h.commands.map((c) => c.id)).toEqual([
      "session_cycler.next",
      "session_cycler.previous",
      "session_cycler.last",
      "session_cycler.sidebar",
    ])
    expect(h.commands.map((c) => c.bind)).toEqual(["alt+j", "alt+k", "<leader>o", "alt+s"])
  })

  test("custom bindings override defaults in V2 layer", async () => {
    const h = await makeHarnessV2({}, { bindings: { next: "ctrl+down", sidebar: "ctrl+s" } })
    expect(h.commands.find((c) => c.id === "session_cycler.next")?.bind).toBe("ctrl+down")
    expect(h.commands.find((c) => c.id === "session_cycler.previous")?.bind).toBe("alt+k")
    expect(h.commands.find((c) => c.id === "session_cycler.sidebar")?.bind).toBe("ctrl+s")
  })
})

describe("OpenCode 2.x (V2) navigation", () => {
  test("from home, next lands on the most recent session", async () => {
    const h = await makeHarnessV2({ sessions: [s("b", 1), s("a", 2)] })
    h.run("next")
    await flush()

    expect(h.dialogClears).toBe(1)
    expect(h.navigations).toEqual([{ type: "session", sessionID: "a" }])
    expect(h.toasts).toEqual(["title-a"])
  })

  test("next cycles forward with wrap-around in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("a", 3), s("b", 2), s("c", 1)],
      route: { type: "session", sessionID: "c" },
    })
    h.run("next")
    await flush()
    expect(h.navigations).toEqual([{ type: "session", sessionID: "a" }])
  })

  test("previous cycles backward in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("a", 3), s("b", 2), s("c", 1)],
      route: { type: "session", sessionID: "a" },
    })
    h.run("previous")
    await flush()
    expect(h.navigations).toEqual([{ type: "session", sessionID: "c" }])
  })

  test("cycling is scoped to the current project in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [
        s("p1-a", 4, { projectID: "p1" }),
        s("p2-x", 3, { projectID: "p2" }),
        s("p1-b", 2, { projectID: "p1" }),
      ],
      route: { type: "session", sessionID: "p1-a" },
    })
    h.run("next")
    await flush()
    expect(h.navigations).toEqual([{ type: "session", sessionID: "p1-b" }])
  })

  test("no sessions at all toasts in V2", async () => {
    const h = await makeHarnessV2({ sessions: [] })
    h.run("next")
    await flush()
    expect(h.navigations).toEqual([])
    expect(h.toasts).toEqual(["No sessions yet"])
  })

  test("stepping onto yourself is a no-op in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("only", 1)],
      route: { type: "session", sessionID: "only" },
    })
    h.run("next")
    await flush()
    expect(h.navigations).toEqual([])
    expect(h.toasts).toEqual(["No other sessions"])
  })

  test("toggle last returns to previously visited session in V2", async () => {
    const h = await makeHarnessV2({ sessions: [s("a", 2), s("b", 1)] })
    h.run("next") // home -> a
    await flush()
    h.state.route = { type: "session", sessionID: "a" }
    h.run("next") // a -> b
    await flush()
    h.state.route = { type: "session", sessionID: "b" }

    h.run("last") // b -> a
    await flush()
    expect(h.navigations.at(-1)).toEqual({ type: "session", sessionID: "a" })
    expect(h.toasts.at(-1)).toBe("title-a")
  })

  test("no previous session on first use in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("a", 1)],
      route: { type: "session", sessionID: "a" },
    })
    h.run("last")
    await flush()
    expect(h.navigations).toEqual([])
    expect(h.toasts).toEqual(["No previous session"])
  })

  test("previous session vanished from the server in V2", async () => {
    const h = await makeHarnessV2({ sessions: [s("a", 2), s("b", 1)] })
    h.run("next")
    await flush()
    h.state.route = { type: "session", sessionID: "a" }
    h.run("next")
    await flush()
    h.state.route = { type: "session", sessionID: "b" }
    h.state.sessions = [s("b", 1)]
    h.run("last")
    await flush()
    expect(h.navigations).toHaveLength(2)
    expect(h.toasts.at(-1)).toBe("Previous session is gone")
  })

  test("rapid double-press runs the cycle only once in V2", async () => {
    const h = await makeHarnessV2({ sessions: [s("a", 2), s("b", 1)] })
    h.run("next")
    h.run("next")
    await flush()
    expect(h.navigations).toHaveLength(1)
  })
})

describe("OpenCode 2.x (V2) sidebar widget & events", () => {
  test("registers a sidebar.content slot", async () => {
    const h = await makeHarnessV2()
    expect(h.slotClaims).toHaveLength(1)
    expect(h.slotClaims[0]?.append).toBe("sidebar.content")
    expect(typeof h.slotClaims[0]?.render).toBe("function")
  })

  test("slot renders against host props in V2", async () => {
    const h = await makeHarnessV2({ sessions: [s("a", 1)] })
    const node = sidebarSlotV2(h)!({ sessionID: "a" })
    expect(node).toBeDefined()
  })

  test("initial list fetch happens on mount in V2", async () => {
    const h = await makeHarnessV2({ sessions: [s("a", 1)] })
    expect(h.listCalls).toBe(0)
    await mountViewV2(h)
    expect(h.listCalls).toBe(1)
  })

  test("toggle command flips storage state and toasts feedback in V2", async () => {
    const h = await makeHarnessV2()
    expect(h.state.collapsed).toBe(false)

    h.run("sidebar")
    expect(h.state.collapsed).toBe(true)
    expect(h.toasts.at(-1)).toBe("Sessions hidden")

    h.run("sidebar")
    expect(h.state.collapsed).toBe(false)
    expect(h.toasts.at(-1)).toBe("Sessions shown")
  })

  test("toggle works with signal fallback when context.storage is missing in V2", async () => {
    const h = await makeHarnessV2({ omitStorage: true })
    h.run("sidebar")
    expect(h.toasts.at(-1)).toBe("Sessions hidden")
  })

  test("missing slot API degrades gracefully in V2", async () => {
    const h = await makeHarnessV2({ omitSlot: true })
    expect(h.slotClaims).toHaveLength(0)

    h.run("sidebar")
    expect(h.toasts).toEqual(["Sidebar unavailable"])
  })

  test("session events trigger refetch in V2", async () => {
    const h = await makeHarnessV2({ sessions: [s("a", 1)] })
    await mountViewV2(h)
    const before = h.listCalls

    h.emit("session.created")
    h.emit("session.deleted")
    h.emit("session.renamed")
    h.emit("session.status")
    h.emit("session.idle")
    await settleDebounce()

    expect(h.listCalls).toBeGreaterThan(before)
  })

  test("bursty events coalesce in V2", async () => {
    const h = await makeHarnessV2({ sessions: [s("a", 1)] })
    await mountViewV2(h)
    const before = h.listCalls

    for (let i = 0; i < 5; i++) h.emit("session.renamed")
    await settleDebounce()

    expect(h.listCalls).toBe(before + 1)
  })

  test("refetch failure keeps previous list in V2", async () => {
    const h = await makeHarnessV2({ sessions: [s("a", 1)] })
    await mountViewV2(h)

    ;(h.context.client.session as { list: () => Promise<unknown> }).list = () => Promise.reject(new Error("server restarting"))
    h.emit("session.renamed")
    await settleDebounce()
  })
})

describe("OpenCode 2.x (V2) sidebar rendering", () => {
  const isFakeEl = (v: unknown): v is { $$el: true; type: unknown; props: Record<string, unknown> } =>
    typeof v === "object" && v !== null && (v as { $$el?: boolean }).$$el === true

  const allStrings = (node: unknown): string[] => {
    const out: string[] = []
    const walk = (n: unknown) => {
      if (typeof n === "string") return void out.push(n)
      if (Array.isArray(n)) return n.forEach(walk)
      if (isFakeEl(n)) walk(n.props.children)
    }
    walk(node)
    return out
  }

  const textEls = (node: unknown): Array<{ $$el: true; type: unknown; props: { children: string; fg?: unknown } }> => {
    const out: Array<{ $$el: true; type: unknown; props: { children: string; fg?: unknown } }> = []
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!isFakeEl(n)) return
      if (n.type === "text" && typeof n.props.children === "string") {
        out.push(n as { $$el: true; type: unknown; props: { children: string; fg?: unknown } })
      }
      walk(n.props.children)
    }
    walk(node)
    return out
  }

  const rowString = (emoji: string, title: string, preview: string) =>
    `${emoji} ${cell(title)} ${cell(preview)}`

  test("header shows Sessions (N); rows show emoji + padded title + padded preview in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("a", 2, { title: "alpha" }), s("b", 1, { title: "beta session here" })],
    })
    h.state.messages["a"] = [{ id: "m1", type: "user", time: { created: 5 }, text: "hello world and more" }]

    await mountViewV2(h)
    const strings = allStrings(sidebarSlotV2(h)!({ sessionID: undefined }))

    expect(strings).toContain("Sessions (2)")
    expect(strings).toContain(rowString("✅", "alpha", "hello world and more"))
    expect(strings).toContain(rowString("✅", "beta sessi", ""))
  })

  test("status emojis in V2: busy ⏳, retry ⚠️, error ⚠️, idle ✅", async () => {
    const h = await makeHarnessV2({
      sessions: [
        s("busy", 4),
        s("errored", 3),
        s("calm", 1),
      ],
    })
    h.state.statuses["busy"] = "running"
    h.state.messages["errored"] = [{ id: "e1", type: "assistant", time: { created: 1 }, error: { name: "ApiError" } }]

    await mountViewV2(h)
    const strings = allStrings(sidebarSlotV2(h)!({ sessionID: undefined }))
    expect(strings).toContain(rowString("⏳", "title-busy", ""))
    expect(strings).toContain(rowString("⚠️", "title-erroe", ""))
    expect(strings).toContain(rowString("✅", "title-calm", ""))
  })

  test("current session is highlighted with V2 theme tokens", async () => {
    const h = await makeHarnessV2({
      sessions: [s("a", 2), s("b", 1)],
      route: { type: "session", sessionID: "b" },
    })

    await mountViewV2(h)
    const els = textEls(sidebarSlotV2(h)!({ sessionID: "b" }))
    const currentRow = els.find((el) => el.props.children.startsWith("✅ title-b"))
    const otherRow = els.find((el) => el.props.children.startsWith("✅ title-a"))

    const themeText = (h.state.theme as unknown as { text: { base: unknown; action: { primary: { base: unknown } } } }).text
    expect(currentRow?.props.fg).toEqual(themeText.action.primary.base)
    expect(otherRow?.props.fg).toEqual(themeText.base)
  })

  test("fallback to legacy theme object in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("a", 1)],
      legacyTheme: true,
      route: { type: "session", sessionID: "a" },
    })

    await mountViewV2(h)
    const els = textEls(sidebarSlotV2(h)!({ sessionID: "a" }))
    const row = els.find((el) => el.props.children.startsWith("✅ title-a"))
    expect(row?.props.fg).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })

  test("collapsed store renders header only in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("a", 2), s("b", 1)],
      collapsed: true,
    })

    await mountViewV2(h)
    const collapsedStrings = allStrings(sidebarSlotV2(h)!({ sessionID: undefined }))
    expect(collapsedStrings).toContain("Sessions (2)")
    expect(collapsedStrings).not.toContain(rowString("✅", "title-a", ""))

    h.run("sidebar")
    await mountViewV2(h)
    const expandedStrings = allStrings(sidebarSlotV2(h)!({ sessionID: undefined }))
    expect(expandedStrings).toContain(rowString("✅", "title-a", ""))
  })

  test("rows are scoped to the viewed project in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [
        s("p1-a", 3, { projectID: "p1" }),
        s("p2-b", 2, { projectID: "p2" }),
      ],
      route: { type: "session", sessionID: "p1-a" },
    })

    await mountViewV2(h)
    const strings = allStrings(sidebarSlotV2(h)!({ sessionID: "p1-a" }))
    expect(strings).toContain("Sessions (1)")
    expect(strings).toContain(rowString("✅", "title-p1-a", ""))
    expect(strings).not.toContain(rowString("✅", "title-p2-b", ""))
  })

  test("empty scope shows no-sessions hint in V2", async () => {
    const h = await makeHarnessV2({ sessions: [] })
    await mountViewV2(h)
    const strings = allStrings(sidebarSlotV2(h)!({ sessionID: undefined }))
    expect(strings).toContain("Sessions (0)")
    expect(strings).toContain("no sessions")
  })

  test("subagent sessions never appear in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("root", 2), s("child", 3, { parentID: "root" })],
    })
    await mountViewV2(h)
    const strings = allStrings(sidebarSlotV2(h)!({ sessionID: undefined }))
    expect(strings).toContain("Sessions (1)")
    expect(strings.join("\n")).not.toContain("title-child")
  })

  test("partsFor extracts content parts on assistant messages in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("ast", 1, { title: "assistant-session" })],
    })
    h.state.messages["ast"] = [
      {
        id: "m2",
        type: "assistant",
        time: { created: 10 },
        content: [{ type: "text", text: "part from v2 content" }],
      },
    ]

    await mountViewV2(h)
    const strings = allStrings(sidebarSlotV2(h)!({ sessionID: undefined }))
    expect(strings).toContain(rowString("✅", "assistant-", "part from "))
  })

  test("partsFor returns empty array when message has no content or is not found in V2", async () => {
    const h = await makeHarnessV2({
      sessions: [s("empty", 1, { title: "empty-session" })],
    })
    h.state.messages["empty"] = [
      {
        id: "m3",
        type: "other",
        time: { created: 10 },
      },
    ]

    await mountViewV2(h)
    const strings = allStrings(sidebarSlotV2(h)!({ sessionID: undefined }))
    expect(strings).toContain(rowString("✅", "empty-sess", ""))
  })
})
