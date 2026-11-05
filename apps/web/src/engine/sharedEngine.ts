/** The app's one engine. It's only downloaded when someone first plays the computer or analyses. */
import { Engine, type EngineWorker } from "./engine";

const ENGINE_FILE = "engine/stockfish-19-lite-single.js";

let shared: Engine | null = null;

export function getEngine(): Engine {
  shared ??= new Engine(() => new Worker(`${import.meta.env.BASE_URL}${ENGINE_FILE}`) as unknown as EngineWorker);
  return shared;
}

export const ENGINE_UNAVAILABLE = "The chess engine couldn't start in this browser. You can still play both sides yourself.";
