// Runs every check. Each one runs even if an earlier one fails, so one pass shows all problems.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { repoRoot, venvPython } from "./python-path.mjs";

const contractDir = join(repoRoot, "packages", "contract");
const tsc = join(contractDir, "node_modules", "typescript", "bin", "tsc");
const webDir = join(repoRoot, "apps", "web");
const webBin = (...path) => join(webDir, "node_modules", ...path);

const checks = [
  ["ruff lint", venvPython, ["-m", "ruff", "check", "."]],
  ["ruff format", venvPython, ["-m", "ruff", "format", "--check", "."]],
  ["pytest", venvPython, ["-m", "pytest", "-q"]],
  ["schema is current", venvPython, ["-m", "ptc_vision.export_schema", "--check"]],
  ["types are current", process.execPath, ["packages/contract/scripts/generate.mjs", "--check"]],
  ["typecheck contract", process.execPath, [tsc, "--noEmit", "-p", "packages/contract"]],
  ["typecheck web", process.execPath, [tsc, "--noEmit", "-p", "apps/web"]],
  ["web tests", process.execPath, [webBin("vitest", "vitest.mjs"), "run"], webDir],
  ["web build", process.execPath, [webBin("vite", "bin", "vite.js"), "build"], webDir],
  ["browser tests", process.execPath, [webBin("@playwright", "test", "cli.js"), "test"], webDir],
];

const failed = [];
for (const [name, command, args, cwd = repoRoot] of checks) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) failed.push(name);
}

if (failed.length > 0) {
  console.error(`\nFAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
