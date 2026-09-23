import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${pkg.version}`) {
  throw new Error("Release tag does not match package.json version");
}
const command = process.platform === "win32" ? "npm.cmd" : "npm";
const report = JSON.parse(execFileSync(command, ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
}));
const packed = Array.isArray(report) ? report[0] : report[pkg.name];
const files = new Map(packed.files.map((file) => [file.path, file.size]));
const entries = [pkg.main, ...Object.values(pkg.exports || {}).flatMap((value) =>
  typeof value === "string" ? [value] : Object.values(value)
)];
for (const entry of entries) {
  if (typeof entry !== "string" || !(files.get(entry.replace(/^\.\//, "")) > 0)) {
    throw new Error(`Package entry is missing or empty: ${entry}`);
  }
}
for (const file of files.keys()) {
  if (!file.startsWith("dist/") && !["package.json", "README.md", "LICENSE"].includes(file)) {
    throw new Error(`Unexpected packed file: ${file}`);
  }
}
console.log(`Verified ${packed.filename}: ${files.size} files`);
