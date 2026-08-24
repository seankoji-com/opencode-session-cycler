/**
 * Collapsible "Sessions (N)" widget for the OpenCode sidebar.
 *
 * Registered into the host's `sidebar_content` slot. Each row shows a status
 * emoji (✅ waiting, ⚠️ error/retry, ⏳ busy), the first 10 characters of the
 * session title, and the first 10 characters of the latest message text. The
 * row for the session you are currently viewing is highlighted.
 *
 * Reactivity model:
 * - the session LIST is fetched via `client.session.list()` and refreshed on
 *   `session.*` events (debounced);
 * - per-session STATUS and MESSAGE data come from reactive host-state reads
 *   (`api.state.session.status/messages`, `api.state.part`) made inside a
 *   memo, so streaming turns re-render rows without any manual wiring.
 */
/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { cycleList, type CyclerSession } from "./cycle"
import { KV_COLLAPSED_KEY, buildRows, createDebouncer, headerLabel } from "./widget"

/** Render priority among sidebar_content contributors (after common packs). */
export const SIDEBAR_ORDER = 600

/** How long to batch bursty session events before refetching the list. */
const REFETCH_DEBOUNCE_MS = 100

/**
 * Shared collapsed/expanded state, persisted through api.kv so the widget
 * comes back the way you left it after a restart. Lives outside the component
 * so the keymap command can flip it too.
 */
export type SidebarStore = {
  collapsed: Accessor<boolean>
  /** Flip collapsed state, persist it, and return the new collapsed value. */
  toggle: () => boolean
}

export function createSidebarStore(api: TuiPluginApi): SidebarStore {
  const [collapsed, setCollapsed] = createSignal<boolean>(api.kv.get(KV_COLLAPSED_KEY, false))
  return {
    collapsed,
    toggle() {
      const next = !collapsed()
      setCollapsed(next)
      api.kv.set(KV_COLLAPSED_KEY, next)
      return next
    },
  }
}

/**
 * Shared session-list state. Lives at plugin scope (not per component mount)
 * so every host re-render of the slot shows the cached list instantly instead
 * of flickering empty while its own fetch resolves.
 */
export type SidebarData = {
  sessions: Accessor<CyclerSession[]>
  /** Idempotent: the first call subscribes events and kicks off a fetch. */
  start: () => void
}

function createSidebarData(api: TuiPluginApi): SidebarData {
  const [sessions, setSessions] = createSignal<CyclerSession[]>([])
  const refetch = createDebouncer(REFETCH_DEBOUNCE_MS)

  const fetchList = async () => {
    try {
      const res = await api.client.session.list()
      setSessions((res.data ?? []) as CyclerSession[])
    } catch {
      // Server hiccup (e.g. restarting): keep showing what we have.
    }
  }

  let started = false
  return {
    sessions,
    start() {
      if (started) return
      started = true
      // Plugin-lifetime subscription: the host tears down the whole plugin
      // context on exit, so there is nothing meaningful to unsubscribe to.
      api.event.on("session.created", () => refetch.run(fetchList))
      api.event.on("session.updated", () => refetch.run(fetchList))
      api.event.on("session.deleted", () => refetch.run(fetchList))
      void fetchList()
    },
  }
}

function SessionsView(props: {
  api: TuiPluginApi
  /** Shared collapsed state so the keybind toggles the same thing as the mouse. */
  store: SidebarStore
  /** Shared, event-refreshed session list. */
  data: SidebarData
  /** Session currently open in the main pane, per the host slot props. */
  sessionID: string | undefined
}) {
  const api = props.api
  const theme = () => api.theme.current

  // Component body runs exactly once per mount; start() is idempotent so the
  // first mount wires events + fetches and later mounts just read the cache.
  props.data.start()

  // --- derived state -------------------------------------------------------
  const currentID = createMemo(() => {
    const route = api.route.current
    if (route.name === "session") {
      const id = route.params?.sessionID
      if (typeof id === "string") return id
    }
    return props.sessionID
  })

  // Scope to the viewed session's project, mirroring the cycler keybinds.
  const anchorProjectID = createMemo(() => {
    const id = currentID()
    return id ? api.state.session.get(id)?.projectID : undefined
  })

  const rows = createMemo(() =>
    buildRows({
      sessions: cycleList(props.data.sessions(), anchorProjectID()),
      currentID: currentID(),
      statusOf: (id) => api.state.session.status(id)?.type,
      messagesOf: (id) => api.state.session.messages(id),
      partsFor: (messageID) => api.state.part(messageID),
    }),
  )

  // --- render --------------------------------------------------------------
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} onMouseDown={() => props.store.toggle()}>
        <text fg={theme().text}>
          <b>{headerLabel(rows().length)}</b>
        </text>
        <text fg={theme().textMuted}>{props.store.collapsed() ? "▶" : "▼"}</text>
      </box>
      <Show when={!props.store.collapsed()}>
        <For each={rows()}>
          {(row) => (
            <text fg={row.isCurrent ? theme().selectedListItemText : theme().text}>
              {`${row.emoji} ${row.title} ${row.preview}`}
            </text>
          )}
        </For>
        <Show when={rows().length === 0}>
          <text fg={theme().textMuted}>no sessions</text>
        </Show>
      </Show>
    </box>
  )
}

/**
 * Register the widget into the host sidebar. Returns a handle for toggling
 * collapse from keybinds, or undefined when the host has no slot API
 * (OpenCode too old for TUI plugins).
 */
export function registerSidebar(api: TuiPluginApi): SidebarStore | undefined {
  if (!api.slots) return undefined
  const store = createSidebarStore(api)
  const data = createSidebarData(api)
  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(_ctx, slotProps) {
        return <SessionsView api={api} store={store} data={data} sessionID={slotProps.session_id} />
      },
    },
  })
  return store
}
