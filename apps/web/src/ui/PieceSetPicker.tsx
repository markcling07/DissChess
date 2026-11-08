import { useId, useState } from "react";
import { applyPieceSet, PIECE_SETS, savedPieceSet, savePieceSet } from "../pieces/sets";

/** Chooses the piece artwork. The choice applies at once and is remembered on this device. */
export function PieceSetPicker() {
  const [chosen, setChosen] = useState(savedPieceSet);
  // Linked by id rather than wrapped, so the select is named "Pieces" alone, not with its value.
  const id = useId();
  return (
    <div className="piece-picker">
      <label htmlFor={id}>Pieces</label>
      <select
        id={id}
        value={chosen}
        onChange={(event) => {
          const set = event.target.value;
          applyPieceSet(set);
          savePieceSet(set);
          setChosen(set);
        }}
      >
        {PIECE_SETS.map((set) => (
          <option key={set.id} value={set.id}>
            {set.name}
          </option>
        ))}
      </select>
    </div>
  );
}
