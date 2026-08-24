import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { cycleList, LastSessionTracker, stepIndex, type CyclerSession } from "./cycle"

export type SessionCyclerOptions = {
  /**
   * Override the default key bindings. Values use OpenCode keybind syntax,
   * e.g. "ctrl+pagedown", "alt+j", "<leader>o".
   */
  bindings?: {
    next?: string
    previous?: string
    last?: string
  }
}

const DEFAULT_BINDINGS = {
  next: "ctrl+right",
  previous: "ctrl+left",
  last: "<leader>o",
} as const

const COMMANDS = {
  next: "session_cycler.next",
  previous: "session_cycler.previous",
  last: "session_cycler.last",
} as const

const tui: TuiPlugin = async (api, options) => {
  const opts: SessionCyclerOptions = options ?? {}
  const tracker = new LastSessionTracker()
  let inFlight = false

  const toast = (message: string) => {
    api.ui.toast({ message, duration: 1200 })
  }

  const currentSessionID = (): string | undefined => {
    const route = api.route.current
    if (route.name !== "session") return undefined
    const id = route.params?.sessionID
    return typeof id === "string" ? id : undefined
  }

  // Scope cycling to the project of the session we're currently viewing so we
  // never jump into a session that belongs to another directory.
  const anchorProjectID = (): string | undefined => {
    const id = currentSessionID()
    return id ? api.state.session.get(id)?.projectID : undefined
  }

  const recentSessions = async (): Promise<CyclerSession[]> => {
    const res = await api.client.session.list()
    return (res.data ?? []) as CyclerSession[]
  }

  const navigateTo = (target: CyclerSession, from: string | undefined) => {
    if (target.id === from) return
    tracker.landed(from, target.id)
    api.ui.dialog.clear()
    api.route.navigate("session", { sessionID: target.id })
    toast(target.title || target.id)
  }

  const guard = <Args>(fn: (...args: Args[]) => Promise<void>) => {
    return (...args: Args[]) => {
      if (inFlight) return
      inFlight = true
      fn(...args).finally(() => {
        inFlight = false
      })
    }
  }

  const cycle = guard(async (delta: 1 | -1) => {
    const from = currentSessionID()
    tracker.observe(from)

    const list = cycleList(await recentSessions(), anchorProjectID())
    if (list.length === 0) return toast("No sessions yet")

    const target = list[stepIndex(list, from, delta)]
    if (!target) return toast("No session to jump to")
    navigateTo(target, from)
  })

  const toggleLast = guard(async () => {
    const from = currentSessionID()
    const last = tracker.observe(from)

    if (!last || last === from) return toast("No previous session")

    const all = await recentSessions()
    const target = all.find((s) => s.id === last)
    if (!target) return toast("Previous session is gone")
    navigateTo(target, from)
  })

  api.keymap.registerLayer({
    mode: "base",
    commands: [
      {
        name: COMMANDS.next,
        title: "Next session",
        category: "Session",
        namespace: "palette",
        run: () => void cycle(1),
      },
      {
        name: COMMANDS.previous,
        title: "Previous session",
        category: "Session",
        namespace: "palette",
        run: () => void cycle(-1),
      },
      {
        name: COMMANDS.last,
        title: "Toggle last session",
        category: "Session",
        namespace: "palette",
        run: () => void toggleLast(),
      },
    ],
    bindings: [
      { key: opts.bindings?.next ?? DEFAULT_BINDINGS.next, cmd: COMMANDS.next, desc: "Next session" },
      { key: opts.bindings?.previous ?? DEFAULT_BINDINGS.previous, cmd: COMMANDS.previous, desc: "Previous session" },
      { key: opts.bindings?.last ?? DEFAULT_BINDINGS.last, cmd: COMMANDS.last, desc: "Toggle last session" },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-session-cycler",
  tui,
}

export default plugin
