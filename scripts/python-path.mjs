import { join, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "..");

export const venvPython =
  process.platform === "win32"
    ? join(repoRoot, ".venv", "Scripts", "python.exe")
    : join(repoRoot, ".venv", "bin", "python");
