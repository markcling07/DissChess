// Creates .venv and installs both Python projects in editable mode.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { repoRoot, venvPython } from "./python-path.mjs";

function run(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(venvPython)) {
  run(process.platform === "win32" ? "py" : "python3", ["-3.12", "-m", "venv", ".venv"]);
}

run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
run(venvPython, ["-m", "pip", "install", "-e", "services/vision[dev]", "-e", "ml[dev]"]);

// Training tools are only needed to rebuild the model, and they're large.
if (process.argv.includes("--train")) {
  run(venvPython, ["-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cpu"]);
  run(venvPython, ["-m", "pip", "install", "-e", "ml[train]"]);
}
