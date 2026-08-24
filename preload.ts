/**
 * Test preload: stub @opentui/solid's JSX runtime so plugin components can be
 * rendered headlessly.
 *
 * The real jsx-runtime forwards intrinsic elements (box/text/...) to the
 * opentui reconciler, which requires a live terminal renderer. Under `bun
 * test` there is none, so we swap in a factory that keeps REAL solid-js
 * reactivity (createComponent, so signals/memos/cleanup all behave) and
 * represents intrinsic elements as plain inspectable objects:
 *
 *   { $$el: true, type: "text", props: { children: "...", fg: ... } }
 *
 * Tests can then walk the returned tree and assert on actual rendered strings
 * and colors. Registered via bunfig.toml [test].preload.
 */
import { createComponent } from "solid-js"
import { mock } from "bun:test"

type FakeElement = { $$el: true; type: unknown; props: Record<string, unknown> }

function intrinsic(type: unknown, props: Record<string, unknown>): FakeElement {
  return { $$el: true, type, props }
}

function makeJsx() {
  return (type: unknown, input: Record<string, unknown> = {}) => {
    const { key: _key, ...props } = input
    if (typeof type === "function") return createComponent(type as never, props)
    return intrinsic(type, props)
  }
}

const jsx = makeJsx()

mock.module("@opentui/solid/jsx-runtime", () => ({
  jsx,
  jsxs: jsx,
  Fragment: (props: { children?: unknown }) => props.children ?? null,
}))

mock.module("@opentui/solid/jsx-dev-runtime", () => ({
  jsx,
  jsxs: jsx,
  jsxDEV: jsx,
  Fragment: (props: { children?: unknown }) => props.children ?? null,
}))
