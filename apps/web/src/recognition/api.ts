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
 * a point on the edge White sits behind when the user gave one. Never throws except when aborted.
 */
export async function recognizeImage(
  image: Blob,
  signal: AbortSignal,
  corners?: Corners,
  white?: Corner,
): Promise<RecognitionResponse> {
  let url = ENDPOINT;
  if (corners) {
    url += `?corners=${cornersParameter(corners)}`;
    if (white) url += `&white=${whiteParameter(white)}`;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: image,
      headers: { "Content-Type": image.type || "application/octet-stream" },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return localFailure(UNAVAILABLE);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return localFailure(UNAVAILABLE);
  }
  const candidate = body as Partial<RecognitionResponse> | null;
  if (candidate?.contract_version !== CONTRACT_VERSION || !candidate.status) {
    return localFailure("The image reader needs updating. Reload the page and try again.");
  }
  return candidate as RecognitionResponse;
}
