import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/patrick-hand/400.css";
import "@lichess-org/chessground/assets/chessground.base.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./pieces/pieces.css";
import "./styles.css";

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
