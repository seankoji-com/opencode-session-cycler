import { describe, test, expect } from "bun:test"

describe("preload dev runtime", () => {
  test("dev runtime mock is registered", async () => {
    // Import the dev runtime to ensure the mock is exercised
    const devRuntime = await import("@opentui/solid/jsx-dev-runtime")
    expect(devRuntime).toBeDefined()
    expect(devRuntime.jsxDEV).toBeDefined()
    expect(devRuntime.Fragment).toBeDefined()
  })

  test("Fragment function returns children", async () => {
    const devRuntime = await import("@opentui/solid/jsx-dev-runtime")
    const Fragment = devRuntime.Fragment as (props: { children?: unknown }) => unknown
    
    // Test with children
    expect(Fragment({ children: "test" })).toBe("test")
    expect(Fragment({ children: ["a", "b"] })).toEqual(["a", "b"])
    
    // Test without children
    expect(Fragment({})).toBeNull()
    expect(Fragment({ children: undefined })).toBeNull()
  })
})
