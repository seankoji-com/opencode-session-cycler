import { describe, expect, test } from "bun:test"
import { cycleList, LastSessionTracker, stepIndex, type CyclerSession } from "../src/cycle"

const s = (id: string, updated: number, extra: Partial<CyclerSession> = {}): CyclerSession => ({
  id,
  time: { updated },
  ...extra,
})

describe("cycleList", () => {
  test("excludes child sessions and sorts most recently updated first", () => {
    const list = cycleList([
      s("a", 100),
      s("child", 999, { parentID: "a" }),
      s("b", 300),
      s("c", 200),
    ])
    expect(list.map((x) => x.id)).toEqual(["b", "c", "a"])
  })

  test("scopes to the anchor project when it has sessions", () => {
    const list = cycleList(
      [
        s("mine", 100, { projectID: "p1" }),
        s("other-newer", 500, { projectID: "p2" }),
        s("mine-older", 50, { projectID: "p1" }),
      ],
      "p1",
    )
    expect(list.map((x) => x.id)).toEqual(["mine", "mine-older"])
  })

  test("falls back to all roots when the anchor project has no sessions", () => {
    const list = cycleList([s("a", 100)], "ghost-project")
    expect(list.map((x) => x.id)).toEqual(["a"])
  })

  test("no anchor means no scoping", () => {
    const list = cycleList([
      s("a", 100, { projectID: "p1" }),
      s("b", 200, { projectID: "p2" }),
    ])
    expect(list.map((x) => x.id)).toEqual(["b", "a"])
  })

  test("treats missing timestamps as oldest", () => {
    const list = cycleList([{ id: "no-time" }, s("a", 1)])
    expect(list.map((x) => x.id)).toEqual(["a", "no-time"])
  })
})

describe("stepIndex", () => {
  const list = [s("a", 3), s("b", 2), s("c", 1)]

  test("empty list yields -1", () => {
    expect(stepIndex([], undefined, 1)).toBe(-1)
    expect(stepIndex([], "a", -1)).toBe(-1)
  })

  test("unknown or absent current lands on the most recent session", () => {
    expect(stepIndex(list, undefined, 1)).toBe(0)
    expect(stepIndex(list, "not-in-list", -1)).toBe(0)
  })

  test("steps forward with wrap-around", () => {
    expect(stepIndex(list, "a", 1)).toBe(1)
    expect(stepIndex(list, "b", 1)).toBe(2)
    expect(stepIndex(list, "c", 1)).toBe(0)
  })

  test("steps backward with wrap-around", () => {
    expect(stepIndex(list, "a", -1)).toBe(2)
    expect(stepIndex(list, "c", -1)).toBe(1)
  })
})

describe("LastSessionTracker", () => {
  test("toggle oscillates between two sessions", () => {
    const t = new LastSessionTracker()
    t.landed(undefined, "a")
    expect(t.observe("a")).toBeUndefined() // nothing before a
    t.landed("a", "b")
    expect(t.observe("b")).toBe("a") // toggle target
    t.landed("b", "a")
    expect(t.observe("a")).toBe("b")
  })

  test("external navigation is detected lazily at command time", () => {
    const t = new LastSessionTracker()
    t.landed(undefined, "a")
    // user opens the session dialog and picks c — tracker wasn't told
    expect(t.observe("c")).toBe("a")
    // now toggle should consider b... no: last was a, we're on c
    t.landed("c", "a")
    expect(t.observe("a")).toBe("c")
  })

  test("first observation on home does not fabricate a last session", () => {
    const t = new LastSessionTracker()
    expect(t.observe(undefined)).toBeUndefined()
    expect(t.observe("a")).toBeUndefined()
  })

  test("external navigation away from home records the abandoned session", () => {
    const t = new LastSessionTracker()
    t.landed(undefined, "a")
    // user jumps to home via <leader>n (route home), then presses toggle
    expect(t.observe(undefined)).toBe("a")
  })
})
