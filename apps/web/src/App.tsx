import { useEffect, useReducer, useState } from "react";
import { standardSetup } from "./chess/position";
import { setupReducer } from "./setup/setupState";
import { GameScreen } from "./ui/GameScreen";
import { SetupScreen } from "./ui/SetupScreen";

export function App() {
  const [setup, dispatch] = useReducer(setupReducer, undefined, standardSetup);
  const [startFen, setStartFen] = useState<string | null>(null);

  // The start button sits low on a long page, so without this the next screen opens scrolled down,
  // with the board out of view.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [startFen]);

  return (
    <>
      <header className="masthead">Photo to Chess</header>
      {startFen === null ? (
        <SetupScreen setup={setup} dispatch={dispatch} onStart={setStartFen} />
      ) : (
        <GameScreen key={startFen} startFen={startFen} onEdit={() => setStartFen(null)} />
      )}
    </>
  );
}
