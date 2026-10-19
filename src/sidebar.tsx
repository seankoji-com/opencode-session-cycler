/**
 * Collapsible "Sessions (N)" widget for the OpenCode sidebar.
 *
 * Registered into the host's `sidebar_content` slot (OpenCode 1.x) or
 * `sidebar.content` slot (OpenCode 2.x). Each row shows a status emoji
 * (✅ waiting, ⚠️ error/retry, ⏳ busy), the first 10 characters of the
 * session title, and the first 10 characters of the latest message text.
 * The row for the session you are currently viewing is highlighted.
 */
/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Plugin } from "@opencode/plugin/tui"
import type { RGBA } from "@opentui/core"
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { cycleList, type CyclerSession } from "./cycle"
import { KV_COLLAPSED_KEY, buildRows, createDebouncer, headerLabel, type PreviewMessage, type SidebarRow } from "./widget"

/** Render priority among sidebar_content contributors (after common packs). */
export const SIDEBAR_ORDER = 600

/** How long to batch bursty session events before refetching the list. */
const REFETCH_DEBOUNCE_MS = 100

/**
 * Shared collapsed/expanded state.
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

export function createSidebarStoreV2(context: Plugin.Context): SidebarStore {
  if (context.storage?.store) {
    const [state, mutate] = context.storage.store<{ collapsed: boolean }>("sidebar", {
      initial: { collapsed: false },
    })
    return {
      collapsed: () => Boolean(state.collapsed),
      toggle() {
        const next = !state.collapsed
        void mutate((draft: { collapsed: boolean }) => {
          draft.collapsed = next
        })
        return next
      },
    }
  }
  const [collapsed, setCollapsed] = createSignal<boolean>(false)
  return {
    collapsed,
    toggle() {
      const next = !collapsed()
      setCollapsed(next)
      return next
    },
  }
}

/**
 * Shared session-list state.
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
      api.event.on("session.created", () => refetch.run(fetchList))
      api.event.on("session.updated", () => refetch.run(fetchList))
      api.event.on("session.deleted", () => refetch.run(fetchList))
      void fetchList()
    },
  }
}

export function createSidebarDataV2(context: Plugin.Context): SidebarData {
  const [sessions, setSessions] = createSignal<CyclerSession[]>([])
  const refetch = createDebouncer(REFETCH_DEBOUNCE_MS)

  const fetchList = async () => {
    try {
      const res = await context.client.session.list()
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
      if (context.data?.on) {
        context.data.on("session.created", () => refetch.run(fetchList))
        context.data.on("session.deleted", () => refetch.run(fetchList))
        context.data.on("session.renamed", () => refetch.run(fetchList))
        context.data.on("session.idle", () => refetch.run(fetchList))
        context.data.on("session.status", () => refetch.run(fetchList))
      }
      void fetchList()
    },
  }
}

function SessionsList(props: {
  store: SidebarStore
  rows: Accessor<SidebarRow[]>
  theme: () => { text?: string | RGBA; textMuted?: string | RGBA; selectedListItemText?: string | RGBA }
}) {
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} onMouseDown={() => props.store.toggle()}>
        <text fg={props.theme().text}>
          <b>{headerLabel(props.rows().length)}</b>
        </text>
        <text fg={props.theme().textMuted}>{props.store.collapsed() ? "▶" : "▼"}</text>
      </box>
      <Show when={!props.store.collapsed()}>
        <For each={props.rows()}>
          {(row) => (
            <text fg={row.isCurrent ? props.theme().selectedListItemText : props.theme().text}>
              {`${row.emoji} ${row.title} ${row.preview}`}
            </text>
          )}
        </For>
        <Show when={props.rows().length === 0}>
          <text fg={props.theme().textMuted}>no sessions</text>
        </Show>
      </Show>
    </box>
  )
}

function SessionsView(props: {
  api: TuiPluginApi
  store: SidebarStore
  data: SidebarData
  sessionID: string | undefined
}) {
  const api = props.api
  const theme = () => api.theme.current

  props.data.start()

  const currentID = createMemo(() => {
    const route = api.route.current
    if (route.name === "session") {
      const id = route.params?.sessionID
      if (typeof id === "string") return id
    }
    return props.sessionID
  })

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

  return <SessionsList store={props.store} rows={rows} theme={theme} />
}

function SessionsViewV2(props: {
  context: Plugin.Context
  store: SidebarStore
  data: SidebarData
  sessionID: string | undefined
}) {
  const context = props.context
  const theme = () => {
    const t = context.theme
    if (t && typeof t === "object" && "text" in t && typeof t.text === "object" && t.text !== null && "base" in t.text) {
      const textDef = t.text as { base: unknown; muted?: unknown; faint?: unknown; action?: { primary?: { base?: unknown } } }
      const hueDef = (t as unknown as { hue?: { primary?: Record<number, unknown> } }).hue
      return {
        text: textDef.base as RGBA,
        textMuted: (textDef.muted ?? textDef.faint) as RGBA,
        selectedListItemText: (textDef.action?.primary?.base ?? hueDef?.primary?.[500] ?? textDef.base) as RGBA,
      }
    }
    const current = (context.theme as unknown as { current?: { text?: unknown; textMuted?: unknown; selectedListItemText?: unknown } })?.current
    return {
      text: current?.text as RGBA,
      textMuted: current?.textMuted as RGBA,
      selectedListItemText: (current?.selectedListItemText ?? current?.text) as RGBA,
    }
  }

  props.data.start()

  const currentID = createMemo(() => {
    const route = context.ui.router.current()
    if (route.type === "session") {
      return route.sessionID
    }
    return props.sessionID
  })

  const anchorProjectID = createMemo(() => {
    const id = currentID()
    return id ? context.data.session.get(id)?.projectID : undefined
  })

  const rows = createMemo(() => {
    const messages = (id: string) => {
      const list = context.data.session.message?.list(id) ?? []
      return list as unknown as PreviewMessage[]
    }
    return buildRows({
      sessions: cycleList(props.data.sessions(), anchorProjectID()),
      currentID: currentID(),
      statusOf: (id) => {
        const s = context.data.session.status(id)
        if (s === "running") return "busy"
        if (s === "idle") return "idle"
        return undefined
      },
      messagesOf: messages,
      partsFor: () => [],
    })
  })

  return <SessionsList store={props.store} rows={rows} theme={theme} />
}

/**
 * Register the widget into the host sidebar (OpenCode 1.x).
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

/**
 * Register the widget into the host sidebar (OpenCode 2.x).
 */
export function registerSidebarV2(context: Plugin.Context): SidebarStore | undefined {
  if (!context.ui?.slot) return undefined
  const store = createSidebarStoreV2(context)
  const data = createSidebarDataV2(context)
  context.ui.slot({
    append: "sidebar.content",
    render(input: { sessionID?: string }) {
      return <SessionsViewV2 context={context} store={store} data={data} sessionID={input?.sessionID} />
    },
  })
  return store
}
