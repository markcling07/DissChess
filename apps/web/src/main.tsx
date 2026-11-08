import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/patrick-hand/400.css";
import "@lichess-org/chessground/assets/chessground.base.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyPieceSet, savedPieceSet } from "./pieces/sets";
import "./styles.css";

// Before the first render, so pieces never flash in another set.
applyPieceSet(savedPieceSet());

// Lets the app work offline once installed. Only in built versions, as it would interfere with
// development by serving stale files.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("./sw.js").then(async () => {
    const { active } = await navigator.serviceWorker.ready;
    const urls = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.startsWith(location.origin) && !url.includes("/api/"));
    active?.postMessage({ type: "cache-urls", urls });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
