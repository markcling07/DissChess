import { useEffect, useReducer, useState } from "react";
import { initialSession, sessionReducer } from "./setup/sessionState";
import { GameScreen } from "./ui/GameScreen";
import { InputScreen } from "./ui/InputScreen";
import { SetupScreen, type PastedMoves } from "./ui/SetupScreen";

type Screen = "input" | "setup" | "game";

export function App() {
  const [session, dispatch] = useReducer(sessionReducer, undefined, initialSession);
  const [screen, setScreen] = useState<Screen>("input");
  const [start, setStart] = useState<{ fen: string; moves?: PastedMoves }>({ fen: "" });

  // The start button sits low on a long page, so without this the next screen opens scrolled down,
  // with the board out of view.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  return (
    <>
      {screen !== "input" && <header className="masthead">Photo to Chess</header>}
      {screen === "input" && (
        <InputScreen
          onRecognized={(result) => {
            dispatch({ type: "useRecognition", result });
            setScreen("setup");
          }}
          onArrangeByHand={() => {
            dispatch({ type: "startByHand" });
            setScreen("setup");
          }}
        />
      )}
      {screen === "setup" && (
        <SetupScreen
          setup={session.setup}
          review={session.review}
          dispatch={dispatch}
          onUseImage={() => setScreen("input")}
          onStart={(fen, moves) => {
            setStart({ fen, moves });
            setScreen("game");
          }}
        />
      )}
      {screen === "game" && (
        <GameScreen key={start.fen} startFen={start.fen} pasted={start.moves} onEdit={() => setScreen("setup")} />
      )}
    </>
  );
}
