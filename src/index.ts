import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { Plugin } from "@opencode/plugin/tui"
import { cycleList, LastSessionTracker, stepIndex, type CyclerSession } from "./cycle"
import { registerSidebar, registerSidebarV2 } from "./sidebar"

export type SessionCyclerOptions = {
  /**
   * Override the default key bindings. Values use OpenCode keybind syntax,
   * e.g. "ctrl+pagedown", "alt+j", "<leader>o".
   */
  bindings?: {
    next?: string
    previous?: string
    last?: string
    /** Toggle the sessions sidebar widget (also clickable via its header). */
    sidebar?: string
  }
}

export const DEFAULT_BINDINGS = {
  next: "alt+j",
  previous: "alt+k",
  last: "<leader>o",
  // NOT <leader>s: core claims it for status_view. alt+s is unclaimed.
  sidebar: "alt+s",
} as const

export const COMMANDS = {
  next: "session_cycler.next",
  previous: "session_cycler.previous",
  last: "session_cycler.last",
  sidebar: "session_cycler.sidebar",
} as const

export const ID = "opencode-session-cycler"

type KeymapActions = {
  next: () => void
  previous: () => void
  last: () => void
  sidebar: () => void
}

type KeymapBindings = {
  next: string
  previous: string
  last: string
  sidebar: string
}

type CyclerHost = {
  options: SessionCyclerOptions
  toast: (message: string) => void
  currentSessionID: () => string | undefined
  anchorProjectID: () => string | undefined
  recentSessions: () => Promise<CyclerSession[]>
  navigate: (sessionID: string) => void
  registerKeymap: (actions: KeymapActions, bindings: KeymapBindings) => void
  registerSidebar: () => (() => boolean) | undefined
}

export function setupCycler(host: CyclerHost) {
  const opts = host.options
  const tracker = new LastSessionTracker()
  let inFlight = false

  const navigateTo = (target: CyclerSession, from: string | undefined) => {
    if (target.id === from) return
    tracker.landed(from, target.id)
    host.navigate(target.id)
    host.toast(target.title || target.id)
  }

  const guard = <Args extends unknown[]>(fn: (...args: Args) => Promise<void>) => {
    return (...args: Args) => {
      if (inFlight) return
      inFlight = true
      fn(...args).finally(() => {
        inFlight = false
      })
    }
  }

  const cycle = guard(async (delta: 1 | -1) => {
    const from = host.currentSessionID()
    tracker.observe(from)

    const list = cycleList(await host.recentSessions(), host.anchorProjectID())
    if (list.length === 0) return host.toast("No sessions yet")

    const target = list[stepIndex(list, from, delta)]
    if (!target) return host.toast("No session to jump to")
    if (target.id === from) return host.toast("No other sessions")
    navigateTo(target, from)
  })

  const toggleLast = guard(async () => {
    const from = host.currentSessionID()
    const last = tracker.observe(from)

    if (!last || last === from) return host.toast("No previous session")

    const all = await host.recentSessions()
    const target = all.find((s) => s.id === last)
    if (!target) return host.toast("Previous session is gone")
    navigateTo(target, from)
  })

  let sidebarToggle: (() => boolean) | undefined
  try {
    sidebarToggle = host.registerSidebar()
  } catch {
    // A broken slot registration must not take the keybinds down with it.
  }

  const bindings: KeymapBindings = {
    next: opts.bindings?.next ?? DEFAULT_BINDINGS.next,
    previous: opts.bindings?.previous ?? DEFAULT_BINDINGS.previous,
    last: opts.bindings?.last ?? DEFAULT_BINDINGS.last,
    sidebar: opts.bindings?.sidebar ?? DEFAULT_BINDINGS.sidebar,
  }

  host.registerKeymap(
    {
      next: () => void cycle(1),
      previous: () => void cycle(-1),
      last: () => void toggleLast(),
      sidebar: () => {
        if (!sidebarToggle) return host.toast("Sidebar unavailable")
        host.toast(sidebarToggle() ? "Sessions hidden" : "Sessions shown")
      },
    },
    bindings,
  )
}

/**
 * OpenCode 2.x V2 TUI plugin entrypoint.
 */
export const setup = async (context: Plugin.Context): Promise<Plugin.Cleanup | void> => {
  setupCycler({
    options: (context.options as SessionCyclerOptions) ?? {},
    toast: (message) => {
      context.ui.toast.show({ message, duration: 1200 })
    },
    currentSessionID: () => {
      const route = context.ui.router.current()
      if (route.type !== "session") return undefined
      return route.sessionID
    },
    anchorProjectID: () => {
      const route = context.ui.router.current()
      const id = route.type === "session" ? route.sessionID : undefined
      return id ? context.data.session.get(id)?.projectID : undefined
    },
    recentSessions: async () => {
      const res = await context.client.session.list()
      return (res.data ?? []) as CyclerSession[]
    },
    navigate: (sessionID) => {
      context.ui.dialog.clear()
      context.ui.router.navigate({ type: "session", sessionID })
    },
    registerKeymap: (actions, bindings) => {
      context.keymap.layer(() => ({
        mode: "base",
        commands: [
          {
            id: COMMANDS.next,
            title: "Next session",
            group: "Session",
            palette: true,
            bind: bindings.next,
            run: actions.next,
          },
          {
            id: COMMANDS.previous,
            title: "Previous session",
            group: "Session",
            palette: true,
            bind: bindings.previous,
            run: actions.previous,
          },
          {
            id: COMMANDS.last,
            title: "Toggle last session",
            group: "Session",
            palette: true,
            bind: bindings.last,
            run: actions.last,
          },
          {
            id: COMMANDS.sidebar,
            title: "Toggle sessions sidebar",
            group: "Session",
            palette: true,
            bind: bindings.sidebar,
            run: actions.sidebar,
          },
        ],
      }))
    },
    registerSidebar: () => registerSidebarV2(context)?.toggle,
  })
}

/**
 * OpenCode 1.x TUI plugin entrypoint (backward compatibility).
 */
export const tui: TuiPlugin = async (api, options) => {
  setupCycler({
    options: options ?? {},
    toast: (message) => {
      api.ui.toast({ message, duration: 1200 })
    },
    currentSessionID: () => {
      const route = api.route.current
      if (route.name !== "session") return undefined
      const id = route.params?.sessionID
      return typeof id === "string" ? id : undefined
    },
    anchorProjectID: () => {
      const route = api.route.current
      const id = route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
      return id ? api.state.session.get(id)?.projectID : undefined
    },
    recentSessions: async () => {
      const res = await api.client.session.list()
      return (res.data ?? []) as CyclerSession[]
    },
    navigate: (sessionID) => {
      api.ui.dialog.clear()
      api.route.navigate("session", { sessionID })
    },
    registerKeymap: (actions, bindings) => {
      api.keymap.registerLayer({
        mode: "base",
        commands: [
          {
            name: COMMANDS.next,
            title: "Next session",
            category: "Session",
            namespace: "palette",
            run: actions.next,
          },
          {
            name: COMMANDS.previous,
            title: "Previous session",
            category: "Session",
            namespace: "palette",
            run: actions.previous,
          },
          {
            name: COMMANDS.last,
            title: "Toggle last session",
            category: "Session",
            namespace: "palette",
            run: actions.last,
          },
          {
            name: COMMANDS.sidebar,
            title: "Toggle sessions sidebar",
            category: "Session",
            namespace: "palette",
            run: actions.sidebar,
          },
        ],
        bindings: [
          { key: bindings.next, cmd: COMMANDS.next, desc: "Next session" },
          { key: bindings.previous, cmd: COMMANDS.previous, desc: "Previous session" },
          { key: bindings.last, cmd: COMMANDS.last, desc: "Toggle last session" },
          { key: bindings.sidebar, cmd: COMMANDS.sidebar, desc: "Toggle sessions sidebar" },
        ],
      })
    },
    registerSidebar: () => registerSidebar(api)?.toggle,
  })
}

const plugin: TuiPluginModule & { id: string; setup: typeof setup } = {
  id: ID,
  setup,
  tui,
}

export default plugin
