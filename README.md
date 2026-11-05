# Photo to Chess

Turns a photo or screenshot of a chessboard into a playable game. It ships first as an installable web app, then as iOS and Android store apps built from the same code.

**Status: milestone M2, with its accuracy target not yet met.** You can upload, paste or photograph a screenshot of a digital board, check what was read, and play on from it. You can also set up any position by hand. Accuracy varies by piece set, so see [the model's results](services/vision/src/ptc_vision/models/README.md). Photos of real boards and the chess engine aren't built yet. See [docs/plan.md](docs/plan.md) for the milestones and decisions.

## Layout

| Path | Contents |
|---|---|
| `apps/web` | The web app: image input, position editor, validation and game |
| `packages/contract` | JSON Schema and TypeScript types, generated from the Python models |
| `services/vision` | The recognition service and model, including the contract's source of truth |
| `ml` | Evaluation and training tools, never deployed |
| `corpus` | Labelled test images, not committed. See [corpus/README.md](corpus/README.md) |

## Setup

You need Node 24, pnpm 11, Python 3.12 and Microsoft Edge, which the browser tests use. To test in another browser, set `PW_CHANNEL`, for example to `chrome`.

```bash
pnpm install
```

```bash
pnpm setup:python
```

## Commands

| Command | What it does |
|---|---|
| `pnpm service` | Runs the recognition service at http://127.0.0.1:8000 |
| `pnpm --filter @photo-to-chess/web dev` | Runs the web app at http://localhost:5173. Reading images also needs `pnpm service` running |
| `pnpm verify` | Runs lint, tests, type checks, contract checks, the build and the browser tests |
| `pnpm contract:generate` | Regenerates the schema and types after editing `services/vision/src/ptc_vision/contract.py` |
| `pnpm eval run <corpus> --recognizer ptc_vision.engine:make_recognizer` | Measures the engine's accuracy |

## Reading accuracy reports

- **`square_error_overall`** counts a refused image as 64 wrong squares, so an engine can't improve its score by refusing hard images.
- **`occupied_error_overall`** covers only squares holding a piece. Most squares are empty, which flatters plain square error.
- **`silently_wrong_boards`** is the share of recognised boards with a mistake that wasn't flagged for review. This is the number that matters most for users.
- **`flag_rate`** shows how much of the board gets flagged. Read it with `flag_recall`, because flagging every square would give perfect recall and no useful guidance.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE), and [docs/third-party.md](docs/third-party.md) for artwork and libraries.
