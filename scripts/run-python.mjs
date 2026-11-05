// Runs the project's virtual environment Python on any OS.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { repoRoot, venvPython } from "./python-path.mjs";

if (!existsSync(venvPython)) {
  console.error("Python environment not found. Run: pnpm setup:python");
  process.exit(2);
}

const result = spawnSync(venvPython, process.argv.slice(2), { cwd: repoRoot, stdio: "inherit" });
process.exit(result.status ?? 1);
