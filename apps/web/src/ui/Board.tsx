/** The only component that touches Chessground. The chess rules stay outside it. */
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { Key } from "@lichess-org/chessground/types";
import type { Color, Square } from "chess.js";
import { useEffect, useRef } from "react";
import { type PieceCode, type Placement } from "../chess/position";
import { pieceCodeOf } from "./pieces";

export type BoardInteraction =
  | {
      kind: "edit";
      /** While true, tapping a square reports it instead of picking up the piece. */
      tapMode: boolean;
      onPlacementChange: (placement: Placement) => void;
      onSquareTap: (square: Square) => void;
    }
  | {
      /** Shown only: nothing on the board can be moved. */
      kind: "view";
    }
  | {
      kind: "play";
      turn: Color;
      destinations: Map<Square, Square[]>;
      lastMove: [Square, Square] | null;
      check: boolean;
      onMove: (from: Square, to: Square) => void;
    };

export interface BoardProps {
  /** The piece placement field of a FEN. */
  placement: string;
  orientation: Color;
  interaction: BoardInteraction;
  /** Extra classes for particular squares, such as ones needing attention. */
  highlights?: ReadonlyMap<Square, string>;
  /** Arrows drawn over the board, such as the engine's best move. */
  arrows?: readonly { from: Square; to: Square }[];
}

const COLOR_NAME = { w: "white", b: "black" } as const;

function buildConfig(props: BoardProps, onEvent: () => BoardProps): Config {
  const { placement, orientation, interaction, highlights, arrows = [] } = props;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shared: Config = {
    fen: placement,
    orientation: COLOR_NAME[orientation],
    coordinates: true,
    animation: { enabled: !reducedMotion, duration: 150 },
    premovable: { enabled: false },
    predroppable: { enabled: false },
    drawable: {
      enabled: false,
      visible: true,
      autoShapes: arrows.map(({ from, to }) => ({ orig: from, dest: to, brush: "paleBlue" })),
    },
    highlight: { custom: new Map(highlights) as Map<Key, string> },
  };

  // Chessground's viewOnly can't be turned off later, so the locked board just refuses every move.
  if (interaction.kind === "view") {
    return {
      ...shared,
      draggable: { enabled: false },
      selectable: { enabled: false },
      movable: { free: false, color: undefined },
    };
  }

  if (interaction.kind === "edit") {
    return {
      ...shared,
      turnColor: "white",
      check: false,
      lastMove: undefined,
      autoCastle: false,
      highlight: { ...shared.highlight, lastMove: false, check: false },
      draggable: { enabled: !interaction.tapMode, deleteOnDropOff: true },
      selectable: { enabled: !interaction.tapMode },
      movable: {
        free: !interaction.tapMode,
        color: interaction.tapMode ? undefined : "both",
        dests: new Map(),
        showDests: false,
      },
    };
  }

  return {
    ...shared,
    turnColor: COLOR_NAME[interaction.turn],
    check: interaction.check,
    lastMove: interaction.lastMove ?? undefined,
    autoCastle: true,
    highlight: { ...shared.highlight, lastMove: true, check: true },
    draggable: { enabled: true, deleteOnDropOff: false },
    selectable: { enabled: true },
    movable: {
      free: false,
      color: interaction.destinations.size ? COLOR_NAME[interaction.turn] : undefined,
      dests: interaction.destinations,
      showDests: true,
      events: {
        after: (from, to) => {
          const current = onEvent().interaction;
          if (current.kind === "play") current.onMove(from as Square, to as Square);
        },
      },
    },
  };
}

function readPlacement(api: Api): Placement {
  const placement = new Map<Square, PieceCode>();
  for (const [key, piece] of api.state.pieces) {
    placement.set(key as Square, pieceCodeOf(piece.role, piece.color));
  }
  return placement;
}

export function Board(props: BoardProps) {
  const element = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;

  useEffect(() => {
    const getProps = () => latestProps.current;
    const board = Chessground(element.current!, {
      ...buildConfig(getProps(), getProps),
      events: {
        change: () => {
          const { interaction } = getProps();
          if (interaction.kind === "edit") interaction.onPlacementChange(readPlacement(board));
        },
        select: (key) => {
          const { interaction } = getProps();
          if (interaction.kind === "edit" && interaction.tapMode) {
            interaction.onSquareTap(key as Square);
          }
        },
      },
    });
    api.current = board;
    return () => {
      board.destroy();
      api.current = null;
    };
  }, []);

  // Keep the board in step with the app, including putting a piece back after a cancelled move.
  useEffect(() => {
    api.current?.set(buildConfig(props, () => latestProps.current));
  });

  return <div ref={element} className="board" data-testid="board" />;
}
