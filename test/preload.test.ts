import { describe, test, expect } from "bun:test"

describe("preload dev runtime", () => {
  test("dev runtime mock is registered", async () => {
    // Import the dev runtime to ensure the mock is exercised
    const devRuntime = await import("@opentui/solid/jsx-dev-runtime")
    expect(devRuntime).toBeDefined()
    expect(devRuntime.jsxDEV).toBeDefined()
    expect(devRuntime.Fragment).toBeDefined()
  })
})
