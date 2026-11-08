import { afterEach, describe, expect, it, vi } from "vitest";
import { recognizeImage } from "./api";

/** A server that accepts the request and never answers, until the request is aborted. */
function neverAnswers() {
  vi.stubGlobal(
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("reading an image", () => {
  const image = new Blob(["x"], { type: "image/png" });

  it("gives up with a useful message when the reader never answers", async () => {
    neverAnswers();
    const result = await recognizeImage(image, new AbortController().signal, undefined, undefined, 10);
    expect(result).toMatchObject({ status: "error", retryable: true });
    expect(result.status === "error" && result.message).toContain("took too long");
  });

  it("still stops at once when the user cancels", async () => {
    neverAnswers();
    const controller = new AbortController();
    const reading = recognizeImage(image, controller.signal);
    controller.abort();
    await expect(reading).rejects.toThrow("Aborted");
  });

  it("says the reader is unreachable when the connection fails", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const result = await recognizeImage(image, new AbortController().signal);
    expect(result.status === "error" && result.message).toContain("isn't reachable");
  });
});
