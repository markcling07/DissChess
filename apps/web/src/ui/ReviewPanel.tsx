import type { Square } from "chess.js";
import type { Dispatch } from "react";
import type { PieceCode } from "../chess/position";
import { labelToPiece, pieceConfidence, type ReviewState, type SquareReading } from "../recognition/review";
import type { SessionAction } from "../setup/sessionState";
import { PIECE_INFO, PieceImage } from "./pieces";

function labelName(label: string): string {
  return label === "empty" ? "Empty square" : PIECE_INFO[label as PieceCode].name;
}

function percent(probability: number): string {
  const value = probability * 100;
  return value > 99.9 ? ">99.9%" : `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function FlaggedSquare({
  square,
  reading,
  dispatch,
}: {
  square: Square;
  reading: SquareReading;
  dispatch: Dispatch<SessionAction>;
}) {
  const piece = labelToPiece(reading.label);

  function choose(label: string) {
    const replacement = labelToPiece(label);
    if (replacement) dispatch({ type: "place", square, piece: replacement });
    else dispatch({ type: "remove", square });
  }

  return (
    <li className="flag">
      <div className="flag__reading">
        <span className="flag__square">{square}</span>
        {piece && <PieceImage piece={piece} />}
        <span>
          {labelName(reading.label)}, {percent(reading.confidence)} sure
        </span>
      </div>
      <div className="flag__actions">
        <button type="button" onClick={() => dispatch({ type: "review", action: { type: "confirmSquare", square } })}>
          It's right
        </button>
        {reading.alternatives.slice(0, 2).map((alternative) => (
          <button key={alternative.label} type="button" onClick={() => choose(alternative.label)}>
            {labelName(alternative.label)} ({percent(alternative.probability)})
          </button>
        ))}
      </div>
    </li>
  );
}

/** Shows what was read, how sure it was, and what still needs checking against the image. */
export function ReviewPanel({
  review,
  dispatch,
}: {
  review: ReviewState;
  dispatch: Dispatch<SessionAction>;
}) {
  const summary = pieceConfidence(review);
  const pending = review.flagged.size + (review.orientationUnconfirmed ? 1 : 0);
  const pieceReadings = [...review.readings]
    .filter(([, reading]) => reading.label !== "empty")
    .sort(([, a], [, b]) => a.confidence - b.confidence);

  return (
    <section className="review" aria-label="Check the reading">
      {review.preview && (
        <figure className="review__preview">
          <img
            src={review.preview}
            alt="The board found in your image"
            style={{ transform: `rotate(${review.quarterTurns * 90}deg)` }}
          />
          <figcaption>The board in your image. Compare it with the position.</figcaption>
        </figure>
      )}

      {summary && (
        <p className="review__summary">
          Found {summary.pieces} {summary.pieces === 1 ? "piece" : "pieces"}. The least certain is{" "}
          {percent(summary.lowest)} sure.
        </p>
      )}

      {review.orientationUnconfirmed && (
        <div className="flag flag--orientation">
          <p>The pieces don't clearly show which side is at the bottom. Is White at the bottom, as shown?</p>
          <div className="flag__actions">
            <button type="button" onClick={() => dispatch({ type: "review", action: { type: "confirmOrientation" } })}>
              Yes, White's at the bottom
            </button>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "rotate" });
                dispatch({ type: "rotate" });
                dispatch({ type: "review", action: { type: "confirmOrientation" } });
              }}
            >
              No, turn the board around
            </button>
          </div>
        </div>
      )}

      {review.flagged.size > 0 && (
        <ul className="flags" aria-label="Squares to check">
          {[...review.flagged].map(([square, reading]) => (
            <FlaggedSquare key={square} square={square} reading={reading} dispatch={dispatch} />
          ))}
        </ul>
      )}

      {pending > 1 && (
        <button type="button" onClick={() => dispatch({ type: "review", action: { type: "confirmAll" } })}>
          All of these are right
        </button>
      )}

      {pieceReadings.length > 0 && (
        <details className="more">
          <summary>Confidence for every piece</summary>
          <ul className="readings">
            {pieceReadings.map(([square, reading]) => (
              <li key={square}>
                <span className="flag__square">{square}</span>
                <span>{labelName(reading.label)}</span>
                <span>{percent(reading.confidence)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
