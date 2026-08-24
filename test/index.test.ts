import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import plugin from "../src/index"
import type { CyclerSession } from "../src/cycle"
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

/**
 * Boots the real plugin against a mock TUI api and returns handles to drive
 * the registered commands and inspect what the plugin did.
 */
async function makeHarness(
  init: { sessions?: CyclerSession[]; route?: Route } = {},
  options?: Parameters<typeof plugin.tui>[1],
) {
  const state = {
    sessions: init.sessions ?? [],
    route: init.route ?? ({ name: "home" } as Route),
  }
  const toasts: string[] = []
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> = []
  let dialogClears = 0
  const commands = new Map<string, () => void>()
  let layer: { mode: string; commands: unknown[]; bindings: Array<{ key: string; cmd: string }> } | undefined

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
    state: {
      session: {
        get: (sessionID: string) => state.sessions.find((x) => x.id === sessionID),
      },
    },
    client: {
      session: {
        list: async () => ({ data: state.sessions }),
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

  return {
    run,
    toasts,
    navigations,
    get dialogClears() {
      return dialogClears
    },
    get bindings() {
      return layer?.bindings ?? []
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

  test("registers next / previous / last commands in order", async () => {
    const h = await makeHarness()
    expect(h.bindings.map((b) => b.cmd)).toEqual([
      "session_cycler.next",
      "session_cycler.previous",
      "session_cycler.last",
    ])
    // every command is bound to a non-empty, distinct key
    const keys = h.bindings.map((b) => b.key)
    for (const key of keys) expect(key.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(3)
  })

  test("custom bindings override defaults individually", async () => {
    const base = await makeHarness()
    const custom = await makeHarness({}, { bindings: { next: "alt+x" } })
    expect(custom.bindings[0]!.key).toBe("alt+x")
    expect(custom.bindings[1]!.key).toBe(base.bindings[1]!.key)
    expect(custom.bindings[2]!.key).toBe(base.bindings[2]!.key)
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
