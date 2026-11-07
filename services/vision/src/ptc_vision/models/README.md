# Square classifier

Reads one square of a flat digital board as empty or one of the 12 pieces. It runs in about 30 ms per board on a CPU through ONNX Runtime. `square_classifier.json` holds its version, calibration values and training history.

## Training data

Synthetic screenshots from `ml/src/ptc_data`, with varied highlights, arrows, coordinates, page surroundings, sizes and compression. Pieces are also warped, recoloured, hatched and recombined, so training sees many designs that don't exist.

| Use | Artwork | Licences |
|---|---|---|
| Training | cburnett, merida, mpchess, pirouetti, pixel, rhosgfx, fantasy, spatial, totoy, papercut, firi | GPL-2.0+, GPL-3.0+, AGPL-3.0+, CC0, MIT, CC BY 4.0 |
| Calibration, never trained on | chessnut, celtic | Apache-2.0, MIT |
| Testing only, never trained on or shipped | maestro, california, tatiana, staunty, cardinal, gioco, alpha, leipzig, companion | CC BY-NC-SA 4.0 or freeware |

Non-commercial artwork is kept out of training because trained weights may count as derived from their data. Chess.com artwork is also testing only.

## Results

Measured on synthetic screenshots, with the king and pawn rules in `engine.py` applied. **Square error** here sets board orientation aside. **The 0.1% target is met on calibration artwork but not on the held-out artwork.**

| Test | Boards | Square error | Boards with no errors | Silently wrong boards |
|---|---|---|---|---|
| Calibration: chessnut, celtic | 300 | 0.10% | 79.0% | 5.3% |
| Held-out: all sets | 600 | 3.88% | 48.7% | 6.5% |
| Held-out: positions from play | 379 | 5.04% | 57.3% | 6.3% |
| Held-out: play, without leipzig and companion | 281 | Not measured | 77.2% | 1.1% |

Other held-out figures:

| Measure | Result |
|---|---|
| Wrong squares flagged | 91.6% |
| Orientation correct on positions from play | 98.2% |
| Orientation correct on arbitrary or sparse positions | About 50%, usually flagged because the pieces don't settle it |
| Bad images wrongly accepted | 0 of 60 |

Held-out square error by piece set:

| Set | Error | Set | Error | Set | Error |
|---|---|---|---|---|---|
| california | 0.05% | gioco | 0.45% | staunty | 2.75% |
| alpha | 0.30% | maestro | 0.73% | companion | 11.1% |
| tatiana | 0.34% | cardinal | 1.37% | leipzig | 15.1% |

## How far to trust these numbers

- **The held-out score isn't fully independent.** Those sets were used to diagnose errors between training rounds 2 and 3.
- **They're synthetic.** Real site screenshots may differ, and only one real screenshot has been tried so far. It read correctly apart from a piece being dragged.
- **Calibration error on held-out artwork is high, at 24%.** Stated confidence overestimates accuracy on unfamiliar designs, so treat percentages shown to users as a guide.

## Known weaknesses

- Old font-style sets: tall pawns read as bishops, and hatched pieces can be read as the wrong colour, often with high confidence.
- Some pointed or domed queens are read as kings.
- A piece being dragged isn't detected, though it can lower confidence on squares it covers.
- Photos of real boards go to the piece detector below instead.

## Rebuilding

```bash
pnpm setup:python --train
```

```bash
.venv/Scripts/python -m ptc_data.fetch
```

```bash
.venv/Scripts/python -m ptc_data.build_tiles
```

```bash
.venv/Scripts/python -m ptc_train.train_squares
```

Training takes about an hour on a 16-thread CPU.

# Piece detector (photos)

`piece_detector.onnx` finds pieces in a photo of a real board whose corners the user marked. It is
YOLO11n, fine-tuned on Blender renders of eleven CC0 and CC BY 4.0 chess sets mixed with chesscog's
renders. `piece_detector.json` holds its version and the settings `photo.py` uses. It is only used
when the app is opened with `?photos=1`, because whole boards are still rarely read perfectly.

On 330 development photos from ChessReD2K, with true corners and White's side marked, 1.61% of
squares are wrong, 40.9% of boards have no errors, and 92% of wrong squares are flagged while
flagging 3% of squares. The held-out photos haven't been used yet.
Credits and results are in `docs/third-party.md` and `docs/photo-comparison.md`, and
`ml/scripts/train_many_sets.sh` rebuilds it after `python -m ptc_photo.render_many_sets`.
