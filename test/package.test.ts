import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const verifier = fileURLToPath(new URL("../scripts/verify-package.mjs", import.meta.url))
function verify(overrides: Record<string, unknown> = {}, content = "export default {}", tag = "") {
  const dir = mkdtempSync(join(tmpdir(), "package-contract-"))
  try {
    mkdirSync(join(dir, "dist"))
    mkdirSync(join(dir, "src"))
    mkdirSync(join(dir, "lib"))
    writeFileSync(join(dir, "lib/extra.js"), "export default {}")
    writeFileSync(join(dir, "dist/index.js"), content)
    writeFileSync(join(dir, "src/private.ts"), "source must not ship")
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "package-contract-fixture", version: "1.2.3", main: "./dist/index.js", files: ["dist"], ...overrides,
    }))
    return spawnSync(process.execPath, [verifier], {
      cwd: dir, encoding: "utf8",
      env: { ...process.env, RELEASE_TAG: tag, npm_config_cache: join(dir, "npm-cache") },
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe("published package contract", () => {
  test("accepts a nonempty packed entry and matching tag", () => {
    const result = verify({}, undefined, "v1.2.3")
    expect(result.status, result.stderr).toBe(0)
  })
  test("rejects a declared entry missing from the package", () => {
    expect(verify({ main: "./dist/missing.js" }).status).not.toBe(0)
  })
  test("rejects files that exclude an exported chunk", () => {
    expect(verify({ exports: { "./extra": "./lib/extra.js" } }).status).not.toBe(0)
  })
  test("rejects empty entry points", () => {
    expect(verify({}, "").status).not.toBe(0)
  })
  test("rejects unintended source files", () => {
    expect(verify({ files: ["dist", "src"] }).status).not.toBe(0)
  })
  test("rejects missing export targets", () => {
    expect(verify({ exports: { "./tui": "./dist/missing.js" } }).status).not.toBe(0)
  })
  test("rejects tag and package version mismatches", () => {
    expect(verify({}, undefined, "v9.9.9").status).not.toBe(0)
  })
  test("release performs package validation before remote writes", () => {
    const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")
    const validation = release.indexOf("run: bun run build:verify")
    expect(validation).toBeGreaterThan(0)
    expect(release.indexOf("npm install -g npm@11.5.1")).toBeLessThan(validation)
    expect(release.indexOf("git push --atomic")).toBeGreaterThan(validation)
    expect(release.indexOf("run: npm publish")).toBeGreaterThan(validation)
    expect(release).toContain("RELEASE_TAG:")
    expect(release).not.toContain("npm@latest")
  })
})
