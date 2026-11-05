import { useEffect, useRef } from "react";
import type { ScoresheetRow } from "../chess/game";

/** Empty rows keep it looking like a sheet of paper before any moves are written. */
const MINIMUM_ROWS = 12;

export function Scoresheet({
  rows,
  result,
  firstMoveNumber,
}: {
  rows: readonly ScoresheetRow[];
  result: string | null;
  firstMoveNumber: number;
}) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [rows.length, result]);

  const lastNumber = rows.at(-1)?.number ?? firstMoveNumber - 1;
  const blanks = Array.from({ length: Math.max(0, MINIMUM_ROWS - rows.length) }, (_, index) => lastNumber + index + 1);

  return (
    <section className="sheet" aria-label="Moves">
      <div className="sheet__head" aria-hidden="true">
        <span />
        <span>White</span>
        <span>Black</span>
      </div>
      <div className="sheet__body" ref={body}>
        <ol className="sheet__rows">
          {rows.map((row) => (
            <li key={row.number} className="sheet__row">
              <span className="sheet__number">{row.number}</span>
              <span className="sheet__move">{row.white ?? (row.black ? "…" : "")}</span>
              <span className="sheet__move">{row.black ?? ""}</span>
            </li>
          ))}
          {blanks.map((number, index) => (
            <li key={`blank-${number}`} className="sheet__row" aria-hidden="true">
              <span className="sheet__number">{number}</span>
              <span className="sheet__move">{index === 0 && result ? result : ""}</span>
              <span className="sheet__move" />
            </li>
          ))}
        </ol>
        {result && rows.length >= MINIMUM_ROWS && <p className="sheet__result">{result}</p>}
      </div>
    </section>
  );
}
