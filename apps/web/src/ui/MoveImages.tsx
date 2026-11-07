import type { Color } from "chess.js";
import { useEffect, useMemo, useState } from "react";
import type { GameReview } from "../engine/review";
import {
  buildFrames,
  defaultClipStart,
  MAX_CLIP_MOVES,
  moveLabel,
  renderMoveImages,
  saveImages,
  type ClipMove,
} from "../share/moveImages";

const DEFAULT_COUNT = 5;

interface Made {
  readonly files: readonly File[];
  readonly urls: readonly string[];
}

/** Picks a run of moves and saves each one as a picture, for sharing a game move by move. */
export function MoveImages({
  moves,
  review,
  orientation,
  onClose,
}: {
  moves: readonly ClipMove[];
  review: GameReview | null;
  orientation: Color;
  onClose: () => void;
}) {
  const [chosenStart, setStart] = useState(() =>
    defaultClipStart(moves, review, Math.min(DEFAULT_COUNT, moves.length)),
  );
  // Undo can take away the move the clip started from, so it's kept within the moves there are.
  const start = Math.max(0, Math.min(chosenStart, moves.length - 1));
  const available = Math.max(1, Math.min(MAX_CLIP_MOVES, moves.length - start));
  const [wanted, setWanted] = useState(DEFAULT_COUNT);
  const count = Math.min(wanted, available);
  const [made, setMade] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const frames = useMemo(() => buildFrames(moves, review, start, count), [moves, review, start, count]);
  const marked = review !== null && frames.some((frame) => frame.quality !== null);

  // The pictures live only in memory, and go once they're replaced or the panel closes.
  useEffect(() => () => made?.urls.forEach((url) => URL.revokeObjectURL(url)), [made]);

  // A different selection, new moves or a new review makes the pictures out of date. The moves are
  // rebuilt on every render of the game, so what's drawn is compared rather than the objects.
  const signature = frames.map((frame) => `${frame.label}|${frame.after}|${frame.quality}|${frame.note}`).join(";");
  useEffect(() => {
    setMade(null);
    setMessage(null);
  }, [signature, orientation]);

  async function make() {
    setBusy(true);
    setMessage(null);
    try {
      const files = await renderMoveImages(frames, orientation);
      setMade({ files, urls: files.map((file) => URL.createObjectURL(file)) });
    } catch {
      setMessage({ text: "The pictures couldn't be made in this browser.", isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!made || made.files.length === 0) return;
    const outcome = await saveImages(made.files);
    if (outcome === "downloaded") {
      setMessage({ text: "Downloaded. On a computer, they're in your Downloads folder.", isError: false });
    } else if (outcome === "shared") {
      setMessage({ text: "Sent to the share menu.", isError: false });
    }
  }

  return (
    <section className="clips" aria-label="Save moves as pictures">
      <h2 className="analysis__heading">Save moves as pictures</h2>
      <div className="clips__fields">
        <label className="field">
          <span>From move</span>
          <select value={start} onChange={(event) => setStart(Number(event.target.value))}>
            {moves.map((move, ply) => (
              <option key={ply} value={ply}>
                {moveLabel(move.before, move.san)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>How many</span>
          <select value={count} onChange={(event) => setWanted(Number(event.target.value))}>
            {Array.from({ length: available }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!marked && (
        <p className="hint">
          To show marks like !! and ?? on the pictures, open the analysis and review the moves first.
        </p>
      )}

      {made ? (
        <>
          <ol className="clips__thumbs" aria-label="Pictures">
            {made.urls.map((url, i) => (
              <li key={url}>
                <img src={url} alt={`Move ${i + 1}: ${frames[i]?.label ?? ""}`} />
              </li>
            ))}
          </ol>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void save()}>
              Save {made.files.length === 1 ? "picture" : `${made.files.length} pictures`}
            </button>
            <button type="button" onClick={() => setMade(null)}>
              Change moves
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void make()}>
            {busy ? "Making pictures…" : count === 1 ? "Make 1 picture" : `Make ${count} pictures`}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      )}

      <p className="hint">Made on this device. Nothing is uploaded, and the app doesn't keep them.</p>
      {message && (
        <p className={message.isError ? "hint hint--error" : "hint"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
