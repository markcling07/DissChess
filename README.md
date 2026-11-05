# Photo to Chess

Turns a photo or screenshot of a chessboard into a playable game. It ships first as an installable web app, then as iOS and Android store apps built from the same code.

**Status: milestone M0.** The API contract and evaluation tool exist. Image recognition and the game aren't built yet. See [docs/plan.md](docs/plan.md) for the milestones and decisions.

## Layout

| Path | Contents |
|---|---|
| `apps/web` | The web app (from M1) |
| `packages/contract` | JSON Schema and TypeScript types, generated from the Python models |
| `services/vision` | The recognition service, including the contract's source of truth |
| `ml` | Evaluation and training tools, never deployed |
| `corpus` | Labelled test images, not committed. See [corpus/README.md](corpus/README.md) |

## Setup

You need Node 24, pnpm 11 and Python 3.12.

```bash
pnpm install
```

```bash
pnpm setup:python
```

## Commands

| Command | What it does |
|---|---|
| `pnpm verify` | Runs lint, tests, type checks and contract checks |
| `pnpm contract:generate` | Regenerates the schema and types after editing `services/vision/src/ptc_vision/contract.py` |
| `pnpm eval run <corpus> --recognizer module:factory` | Measures an engine's accuracy |

## Reading accuracy reports

- **`square_error_overall`** counts a refused image as 64 wrong squares, so an engine can't improve its score by refusing hard images.
- **`occupied_error_overall`** covers only squares holding a piece. Most squares are empty, which flatters plain square error.
- **`silently_wrong_boards`** is the share of recognised boards with a mistake that wasn't flagged for review. This is the number that matters most for users.
- **`flag_rate`** shows how much of the board gets flagged. Read it with `flag_recall`, because flagging every square would give perfect recall and no useful guidance.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE).
