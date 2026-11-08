import type { Color, Square } from "chess.js";
import { useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent } from "react";
import {
  CASTLING_RIGHTS,
  canHoldCastlingRight,
  enPassantOptions,
  parseFen,
  toFen,
  toPlacementString,
  type CastlingRight,
  type PieceCode,
  type PositionSetup,
} from "../chess/position";
import { positionFromMoves } from "../chess/moves";
import { forcedSideToMove, hasBlockingIssue, validatePosition } from "../chess/validate";
import { unresolvedCount, type ReviewState } from "../recognition/review";
import type { SessionAction } from "../setup/sessionState";
import { normaliseSetup, resolveSetup } from "../setup/setupState";
import { Board } from "./Board";
import { IssueList } from "./IssueList";
import { PIECE_INFO, PieceImage } from "./pieces";
import { ReviewPanel } from "./ReviewPanel";

type Tool = PieceCode | "erase" | null;

const WHITE_PIECES: readonly PieceCode[] = ["K", "Q", "R", "B", "N", "P"];
const BLACK_PIECES: readonly PieceCode[] = ["k", "q", "r", "b", "n", "p"];
const SIDE_NAME: Record<Color, string> = { w: "White", b: "Black" };
const CASTLING_LABEL: Record<CastlingRight, string> = {
  K: "White kingside",
  Q: "White queenside",
  k: "Black kingside",
  q: "Black queenside",
};

function parseCounter(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

/** A pasted move list, kept so the game can show and review the moves that led here. */
export interface PastedMoves {
  readonly startFen: string;
  readonly sans: readonly string[];
}

/** Compares pieces, side, castling and en passant. The move counters don't change the position. */
function samePosition(a: string, b: string): boolean {
  return a.split(" ").slice(0, 4).join(" ") === b.split(" ").slice(0, 4).join(" ");
}

export function SetupScreen({
  setup,
  review = null,
  dispatch,
  onStart,
  onUseImage,
  lastStart,
}: {
  setup: PositionSetup;
  review?: ReviewState | null;
  dispatch: Dispatch<SessionAction>;
  /** Moves come along when the position is the one a pasted move list reached, unchanged since. */
  onStart: (fen: string, moves?: PastedMoves) => void;
  onUseImage?: () => void;
  /**
   * The game this screen last started, so its pasted moves survive a trip back here to edit. They
   * still only carry over if the position is left as it was.
   */
  lastStart?: { fen: string; moves?: PastedMoves };
}) {
  const [tool, setTool] = useState<Tool>(null);
  const dragNewPiece = useRef<((piece: PieceCode, event: PointerEvent) => void) | null>(null);
  // After reading an image the board is shown, not arranged, or dragging a piece looks like playing.
  // Coming back from a game through Edit position, arranging is what was asked for.
  const [fixing, setFixing] = useState(Boolean(lastStart?.fen));
  const locked = review !== null && !fixing;
  const [fenDraft, setFenDraft] = useState("");
  const [fenMessage, setFenMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [movesDraft, setMovesDraft] = useState("");
  const [movesError, setMovesError] = useState<string | null>(null);
  const pasted = lastStart?.moves ? { fen: lastStart.fen, moves: lastStart.moves } : null;

  const resolved = useMemo(() => resolveSetup(setup), [setup]);
  const issues = useMemo(() => validatePosition(resolved), [resolved]);
  const forcedSide = useMemo(() => forcedSideToMove(setup.placement), [setup.placement]);
  const unresolved = unresolvedCount(review);
  const blocked = hasBlockingIssue(issues) || unresolved > 0;
  const side = resolved.sideToMove;
  const epOptions = side ? enPassantOptions(setup.placement, side) : [];

  const highlights = useMemo(() => {
    const squares = new Map<Square, string>();
    for (const square of review?.flagged.keys() ?? []) squares.set(square, "needs-review");
    for (const issue of issues) {
      if (issue.severity === "blocking") {
        for (const square of issue.squares) squares.set(square, "needs-fixing");
      }
    }
    return squares;
  }, [issues, review]);

  /** The position with this side to move, or null while something stops the game starting. */
  function startingAs(color: Color): PositionSetup | null {
    const chosen = resolveSetup({ ...setup, sideToMove: color });
    return unresolved === 0 && !hasBlockingIssue(validatePosition(chosen)) ? chosen : null;
  }

  function startAs(color: Color) {
    const chosen = startingAs(color);
    if (!chosen) return;
    // Kept for Edit position, which comes back here.
    dispatch({ type: "setSide", side: color });
    onStart(toFen(chosen));
  }

  const quickSides: readonly Color[] = forcedSide ? [forcedSide] : ["w", "b"];
  const canStartNow = quickSides.some((color) => startingAs(color) !== null);

  function handleTap(square: Square) {
    if (tool === "erase") dispatch({ type: "remove", square });
    else if (tool) dispatch({ type: "place", square, piece: tool });
  }

  function loadFen() {
    try {
      const parsed = parseFen(fenDraft);
      const normalised = normaliseSetup(parsed);
      const dropped =
        CASTLING_RIGHTS.some((right) => parsed.castling[right] !== normalised.castling[right]) ||
        parsed.enPassant !== normalised.enPassant;
      dispatch({ type: "load", setup: parsed });
      setFenMessage({
        text: dropped
          ? "Loaded. Castling or en passant details that didn't fit the board were removed."
          : "Loaded.",
        isError: false,
      });
    } catch (error) {
      setFenMessage({ text: (error as Error).message, isError: true });
    }
  }

  function loadMoves() {
    try {
      const result = positionFromMoves(movesDraft);
      // Kept for Edit position, which comes back here.
      dispatch({ type: "load", setup: parseFen(result.fen) });
      // A list of moves is already a legal game, so it goes straight to the board that enforces the
      // rules. This screen lets pieces go anywhere, which is what arranging a position needs.
      onStart(result.fen, { startFen: result.startFen, sans: result.sans });
    } catch (error) {
      setMovesError((error as Error).message);
    }
  }

  return (
    <main className="layout layout--setup">
      <section className="layout__board" aria-label="Position">
        <Board
          placement={toPlacementString(setup.placement)}
          orientation="w"
          highlights={highlights}
          dragNewPiece={dragNewPiece}
          interaction={
            locked
              ? { kind: "view" }
              : {
                  kind: "edit",
                  tapMode: tool !== null,
                  onPlacementChange: (placement) => dispatch({ type: "setPlacement", placement }),
                  onSquareTap: handleTap,
                }
          }
        />

        {locked ? (
          <>
            <p className="hint">
              {canStartNow
                ? "Does this match your image? Choose who plays next to start the game."
                : unresolved > 0
                  ? "Some squares need checking first. They're marked on the board and listed with the reading."
                  : "This position has a problem to fix first. It's listed with the settings."}
            </p>
            <div className="start-choice" role="group" aria-label="Start the game">
              {quickSides.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="primary"
                  disabled={startingAs(color) === null}
                  onClick={() => startAs(color)}
                >
                  {SIDE_NAME[color]} to play
                </button>
              ))}
            </div>
            <div className="actions">
              <button type="button" onClick={() => setFixing(true)}>
                Fix a piece
              </button>
              {onUseImage && (
                <button type="button" onClick={onUseImage}>
                  Use an image instead
                </button>
              )}
            </div>
          </>
        ) : (
          <>
          <div className="palette" role="group" aria-label="Pieces to add to the board">
            <ToolButton active={tool === null} label="Move pieces" onClick={() => setTool(null)}>
              <span className="tool-text">Move</span>
            </ToolButton>
            {WHITE_PIECES.map((piece) => (
              <ToolButton
                key={piece}
                active={tool === piece}
                label={`Place ${PIECE_INFO[piece].name.toLowerCase()}`}
                onClick={() => setTool(piece)}
                onPointerDown={(event) => {
                  if (event.button === 0) dragNewPiece.current?.(piece, event.nativeEvent);
                }}
              >
                <PieceImage piece={piece} />
              </ToolButton>
            ))}
            <ToolButton active={tool === "erase"} label="Remove pieces" onClick={() => setTool("erase")}>
              <span className="tool-text">Erase</span>
            </ToolButton>
            {BLACK_PIECES.map((piece) => (
              <ToolButton
                key={piece}
                active={tool === piece}
                label={`Place ${PIECE_INFO[piece].name.toLowerCase()}`}
                onClick={() => setTool(piece)}
                onPointerDown={(event) => {
                  if (event.button === 0) dragNewPiece.current?.(piece, event.nativeEvent);
                }}
              >
                <PieceImage piece={piece} />
              </ToolButton>
            ))}
          </div>

          <div className="actions">
            <button type="button" onClick={() => dispatch({ type: "standard" })}>
              Standard position
            </button>
            <button type="button" onClick={() => dispatch({ type: "clear" })}>
              Clear board
            </button>
            <button type="button" onClick={() => dispatch({ type: "rotate" })}>
              Rotate pieces 90°
            </button>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "rotate" });
                dispatch({ type: "rotate" });
              }}
            >
              Turn board around
            </button>
            {onUseImage && (
              <button type="button" onClick={onUseImage}>
                Use an image instead
              </button>
            )}
            {review && (
              <button
                type="button"
                onClick={() => {
                  setFixing(false);
                  setTool(null);
                }}
              >
                Done fixing
              </button>
            )}
          </div>
          </>
        )}
      </section>

      <section className="layout__side panel">
        <h1>{review ? "Check the position" : "Set up the position"}</h1>
        {review && <ReviewPanel review={review} dispatch={dispatch} />}
        {!review && <p className="hint">Drag pieces from the tray onto the board. Drag one off to remove it.</p>}

        <fieldset>
          <legend>Whose turn is it?</legend>
          <div className="segmented">
            {(["w", "b"] as const).map((color) => (
              <label key={color} className="segmented__option">
                <input
                  type="radio"
                  name="side"
                  checked={side === color}
                  disabled={forcedSide !== null}
                  onChange={() => dispatch({ type: "setSide", side: color })}
                />
                <span>{SIDE_NAME[color]}</span>
              </label>
            ))}
          </div>
          {forcedSide && (
            <p className="hint">
              {SIDE_NAME[forcedSide]} is in check, so it must be {SIDE_NAME[forcedSide]}'s turn.
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>Who can still castle?</legend>
          <div className="checks">
            {CASTLING_RIGHTS.map((right) => {
              const available = canHoldCastlingRight(setup.placement, right);
              return (
                <label key={right} className={available ? "check" : "check check--off"}>
                  <input
                    type="checkbox"
                    checked={setup.castling[right]}
                    disabled={!available}
                    onChange={(event) =>
                      dispatch({ type: "setCastling", right, value: event.target.checked })
                    }
                  />
                  <span>{CASTLING_LABEL[right]}</span>
                </label>
              );
            })}
          </div>
          <p className="hint">
            Only available with the king and rook on their home squares. Leave unticked if they've moved
            or you aren't sure.
          </p>
        </fieldset>

        <details className="more">
          <summary>En passant and move numbers</summary>

          <label className="field">
            <span>En passant capture on</span>
            <select
              value={setup.enPassant ?? ""}
              disabled={!epOptions.length}
              onChange={(event) =>
                dispatch({ type: "setEnPassant", square: (event.target.value || null) as Square | null })
              }
            >
              <option value="">None</option>
              {epOptions.map((square) => (
                <option key={square} value={square}>
                  {square}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">Only if the last move was a pawn moving two squares next to an enemy pawn.</p>

          <div className="field-row">
            <label className="field">
              <span>Moves since a capture or pawn move</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={Number.isNaN(setup.halfmove) ? "" : setup.halfmove}
                onChange={(event) => dispatch({ type: "setHalfmove", value: parseCounter(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Move number</span>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={Number.isNaN(setup.fullmove) ? "" : setup.fullmove}
                onChange={(event) => dispatch({ type: "setFullmove", value: parseCounter(event.target.value) })}
              />
            </label>
          </div>
          <p className="hint">If you don't know these, leave them. They only affect the fifty-move draw and how moves are numbered.</p>
        </details>

        <details className="more">
          <summary>Load a FEN</summary>
          <label className="field">
            <span>FEN</span>
            <input
              type="text"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={fenDraft}
              onChange={(event) => setFenDraft(event.target.value)}
            />
          </label>
          <button type="button" onClick={loadFen}>
            Load FEN
          </button>
          {fenMessage && (
            <p className={fenMessage.isError ? "hint hint--error" : "hint"} role="status">
              {fenMessage.text}
            </p>
          )}
        </details>

        <details className="more">
          <summary>Paste moves</summary>
          <p className="hint">
            Type or paste the moves played so far, like 1. e4 e5 2. Nf3. A PGN or a list copied from a game page works
            too. The game opens at the last move, ready to play on.
          </p>
          <label className="field">
            <span>Moves</span>
            <textarea
              rows={4}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={movesDraft}
              onChange={(event) => setMovesDraft(event.target.value)}
            />
          </label>
          <button type="button" onClick={loadMoves}>
            Load moves
          </button>
          {movesError && (
            <p className="hint hint--error" role="status">
              {movesError}
            </p>
          )}
        </details>

        <IssueList issues={issues} />
        {unresolved > 0 && (
          <p className="issue issue--blocking">
            {unresolved === 1 ? "1 thing still needs" : `${unresolved} things still need`} checking above. Fix or
            confirm {unresolved === 1 ? "it" : "them"} to start.
          </p>
        )}

        {!blocked && side && <p className="fen">{toFen(resolved)}</p>}

        <button
          type="button"
          className="primary"
          disabled={blocked}
          onClick={() => {
            const fen = toFen(resolved);
            if (pasted && samePosition(fen, pasted.fen)) onStart(fen, pasted.moves);
            else onStart(fen);
          }}
        >
          Start game
        </button>
      </section>
    </main>
  );
}

function ToolButton({
  active,
  label,
  onClick,
  onPointerDown,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "tool tool--active" : "tool"}
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {children}
    </button>
  );
}
