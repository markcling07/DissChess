/** Talks to the recognition service. Nothing else in the app knows how recognition is done. */
import {
  CONTRACT_VERSION,
  type RecognitionFailure,
  type RecognitionResponse,
} from "@photo-to-chess/contract";
import { cornersParameter, whiteParameter, type Corner, type Corners } from "./corners";

const ENDPOINT = `${import.meta.env.VITE_RECOGNITION_URL ?? ""}/api/v1/recognize`;

const UNAVAILABLE =
  "The image reader isn't reachable right now. Check your connection and try again, or arrange the position by hand.";

const TOO_SLOW =
  "The image reader took too long to answer. Try again in a minute, or arrange the position by hand.";

/** Long enough for a free server to wake from sleep, which can take about a minute. */
export const READ_TIMEOUT_MS = 90_000;

function localFailure(message: string): RecognitionFailure {
  return {
    contract_version: CONTRACT_VERSION,
    status: "error",
    code: "internal_error",
    message,
    retryable: true,
    board_candidates: [],
  };
}

/**
 * Sends an image for reading. A photo of a real board goes with the corners the user marked, and
 * a point on the edge White sits behind when the user gave one. Gives up after a time limit, so a
 * server that never answers can't leave the user waiting. Never throws except when aborted.
 */
export async function recognizeImage(
  image: Blob,
  signal: AbortSignal,
  corners?: Corners,
  white?: Corner,
  timeoutMs: number = READ_TIMEOUT_MS,
): Promise<RecognitionResponse> {
  let url = ENDPOINT;
  if (corners) {
    url += `?corners=${cornersParameter(corners)}`;
    if (white) url += `&white=${whiteParameter(white)}`;
  }

  // The user's cancel and the time limit both stop the request, and are told apart afterwards.
  const limit = new AbortController();
  const stop = () => limit.abort();
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);

  let body: unknown;
  try {
    const response = await fetch(url, {
      method: "POST",
      body: image,
      headers: { "Content-Type": image.type || "application/octet-stream" },
      signal: limit.signal,
    });
    body = await response.json();
  } catch (error) {
    if (signal.aborted) throw error;
    return localFailure(timedOut ? TOO_SLOW : UNAVAILABLE);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
  const candidate = body as Partial<RecognitionResponse> | null;
  if (candidate?.contract_version !== CONTRACT_VERSION || !candidate.status) {
    return localFailure("The image reader needs updating. Reload the page and try again.");
  }
  return candidate as RecognitionResponse;
}
