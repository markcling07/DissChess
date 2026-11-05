// Regenerates the JSON Schema from the Python models, then the TypeScript types from the schema.
import { spawnSync } from "node:child_process";
import { repoRoot, venvPython } from "./python-path.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(venvPython, ["-m", "ptc_vision.export_schema"]);
run(process.execPath, ["packages/contract/scripts/generate.mjs"]);
