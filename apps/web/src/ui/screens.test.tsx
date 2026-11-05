import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Square } from "chess.js";
import { useReducer } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptySetup, parseFen, standardSetup, type PositionSetup } from "../chess/position";
import { setupReducer } from "../setup/setupState";
import type { BoardProps } from "./Board";
import { GameScreen } from "./GameScreen";
import { SetupScreen } from "./SetupScreen";

// The real board needs layout, which jsdom doesn't have. It's exercised in a real browser instead.
let board: BoardProps;
vi.mock("./Board", () => ({
  Board: (props: BoardProps) => {
    board = props;
    return <div data-testid="board">{props.placement}</div>;
  },
}));

function Setup({ initial, onStart }: { initial: PositionSetup; onStart: (fen: string) => void }) {
  const [setup, dispatch] = useReducer(setupReducer, initial);
  return <SetupScreen setup={setup} dispatch={dispatch} onStart={onStart} />;
}

function button(name: string | RegExp) {
  return screen.getByRole("button", { name });
}

function playMove(from: Square, to: Square) {
  act(() => {
    if (board.interaction.kind !== "play") throw new Error("not playing");
    board.interaction.onMove(from, to);
  });
}

afterEach(cleanup);

describe("setup screen", () => {
  it("won't start until the side to move is chosen, and doesn't choose one itself", () => {
    const onStart = vi.fn();
    render(<Setup initial={{ ...standardSetup(), sideToMove: null }} onStart={onStart} />);
    expect(screen.getByText("Choose whose turn it is.")).toBeTruthy();
    expect((button("Start game") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("White") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Black") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByLabelText("Black"));
    fireEvent.click(button("Start game"));
    expect(onStart).toHaveBeenCalledWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1");
  });

  it("explains an empty board and blocks it", () => {
    render(<Setup initial={emptySetup()} onStart={vi.fn()} />);
    expect(screen.getByText("White has no king. Add one.")).toBeTruthy();
    expect(screen.getByText("Black has no king. Add one.")).toBeTruthy();
    expect((button("Start game") as HTMLButtonElement).disabled).toBe(true);
  });

  it("places and erases pieces by tapping, including replacing a wrong piece", () => {
    render(<Setup initial={standardSetup()} onStart={vi.fn()} />);
    const tap = (square: Square) =>
      act(() => {
        if (board.interaction.kind !== "edit") throw new Error("not editing");
        board.interaction.onSquareTap(square);
      });

    fireEvent.click(button("Place black queen"));
    expect(board.interaction).toMatchObject({ tapMode: true });
    tap("a2");
    expect(screen.getByTestId("board").textContent).toBe("rnbqkbnr/pppppppp/8/8/8/8/qPPPPPPP/RNBQKBNR");

    fireEvent.click(button("Remove pieces"));
    tap("a2");
    expect(screen.getByTestId("board").textContent).toBe("rnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR");

    fireEvent.click(button("Move pieces"));
    expect(board.interaction).toMatchObject({ tapMode: false });
  });

  it("settles the side when a king is in check, and says why", () => {
    render(<Setup initial={parseFen("4k3/8/8/8/8/8/4R3/4K3")} onStart={vi.fn()} />);
    expect(screen.getByText("Black is in check, so it must be Black's turn.")).toBeTruthy();
    expect((screen.getByLabelText("Black") as HTMLInputElement).checked).toBe(true);
    expect((button("Start game") as HTMLButtonElement).disabled).toBe(false);
  });

  it("only offers castling when the king and rook are at home", () => {
    render(<Setup initial={parseFen("4k3/8/8/8/8/8/8/4K2R w - - 0 1")} onStart={vi.fn()} />);
    expect((screen.getByLabelText("White kingside") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText("White queenside") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Black kingside") as HTMLInputElement).disabled).toBe(true);
  });

  it("highlights the squares behind a blocking problem", () => {
    render(<Setup initial={parseFen("4k3/8/8/8/8/8/8/K3K3 w - - 0 1")} onStart={vi.fn()} />);
    expect(board.highlights?.get("a1")).toBe("needs-fixing");
    expect(board.highlights?.get("e1")).toBe("needs-fixing");
  });

  it("loads a FEN, and says when it removed details that didn't fit", () => {
    render(<Setup initial={emptySetup()} onStart={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("FEN"), { target: { value: "4k3/8/8/8/8/8/8/4K3 w KQ - 0 1" } });
    fireEvent.click(button("Load FEN"));
    expect(screen.getByTestId("board").textContent).toBe("4k3/8/8/8/8/8/8/4K3");
    expect(screen.getByRole("status").textContent).toContain("were removed");
  });

  it("shows why a FEN can't be read, and keeps the current position", () => {
    render(<Setup initial={standardSetup()} onStart={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("FEN"), { target: { value: "not a fen" } });
    fireEvent.click(button("Load FEN"));
    expect(screen.getByRole("status").textContent).toContain("8 ranks");
    expect(screen.getByTestId("board").textContent).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
  });

  it("warns about an unusual position but lets it be played", () => {
    render(<Setup initial={parseFen("4k3/8/8/8/8/QQ6/PPPPPPPP/4K3 w - - 0 1")} onStart={vi.fn()} />);
    expect(screen.getByText(/more promoted pieces than missing pawns/)).toBeTruthy();
    expect((button("Start game") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("game screen", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  it("records moves, and Undo steps back", () => {
    render(<GameScreen startFen={START} onEdit={vi.fn()} />);
    expect((button("Undo") as HTMLButtonElement).disabled).toBe(true);

    playMove("e2", "e4");
    expect(screen.getByRole("status").textContent).toBe("Black to move.");
    expect(within(screen.getByRole("region", { name: "Moves" })).getByText("e4")).toBeTruthy();

    fireEvent.click(button("Undo"));
    expect(screen.getByRole("status").textContent).toBe("White to move.");
    expect(screen.getByTestId("board").textContent).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
  });

  it("asks for a promotion piece, then plays it", () => {
    render(<GameScreen startFen="8/P6k/8/8/8/8/7K/8 w - - 0 1" onEdit={vi.fn()} />);
    playMove("a7", "a8");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(button("White knight"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("board").textContent).toBe("N7/7k/8/8/8/8/7K/8");
  });

  it("puts the pawn back if the promotion is cancelled", () => {
    render(<GameScreen startFen="8/P6k/8/8/8/8/7K/8 w - - 0 1" onEdit={vi.fn()} />);
    playMove("a7", "a8");
    fireEvent.click(button("Cancel move"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("board").textContent).toBe("8/P6k/8/8/8/8/7K/8");
    expect(screen.getByRole("status").textContent).toBe("White to move.");
  });

  it("ends the game on checkmate and writes the result", () => {
    render(<GameScreen startFen="rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2" onEdit={vi.fn()} />);
    playMove("d8", "h4");
    expect(screen.getByRole("status").textContent).toBe("Checkmate. Black wins.");
    expect(screen.getByText("0–1")).toBeTruthy();
    expect(board.interaction).toMatchObject({ kind: "play", check: true });
    if (board.interaction.kind === "play") expect(board.interaction.destinations.size).toBe(0);
  });

  it("restart needs a second tap once moves are played, and returns to the exact position", () => {
    const fen = "4k3/8/8/8/8/8/4P3/4K3 b - - 12 40";
    render(<GameScreen startFen={fen} onEdit={vi.fn()} />);
    playMove("e8", "d8");

    fireEvent.click(button("Restart"));
    expect(screen.getByTestId("board").textContent).toBe("3k4/8/8/8/8/8/4P3/4K3");
    fireEvent.click(button("Tap again to restart"));
    expect(screen.getByTestId("board").textContent).toBe("4k3/8/8/8/8/8/4P3/4K3");
    expect(screen.getByRole("status").textContent).toBe("Black to move.");
  });

  it("keeps the position's own move numbers", () => {
    render(<GameScreen startFen="4k3/8/8/8/8/8/4P3/4K3 b - - 0 30" onEdit={vi.fn()} />);
    playMove("e8", "d8");
    const sheet = within(screen.getByRole("region", { name: "Moves" }));
    expect(sheet.getByText("Kd8")).toBeTruthy();
    expect(sheet.getByText("30")).toBeTruthy();
    expect(sheet.getByText("…")).toBeTruthy();
  });

  it("edit returns straight away with no moves, and needs a second tap with moves", () => {
    const onEdit = vi.fn();
    render(<GameScreen startFen={START} onEdit={onEdit} />);
    playMove("e2", "e4");
    fireEvent.click(button("Edit position"));
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(button("Tap again to discard moves"));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("flips the board without changing the game", () => {
    render(<GameScreen startFen={START} onEdit={vi.fn()} />);
    expect(board.orientation).toBe("w");
    fireEvent.click(button("Flip board"));
    expect(board.orientation).toBe("b");
    expect(screen.getByRole("status").textContent).toBe("White to move.");
  });
});
