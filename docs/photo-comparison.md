# Photo model comparison (M3)

Both candidates were tested on ChessReD2K photos of real boards: settings were chosen on 330
development photos, and the 306 held-out photos were run once. ChessReD is for testing only and was
never trained on.

## Results on held-out photos

"Wrong squares" takes the board's best rotation, because neither candidate works out which way the
board faces. These figures therefore count only boards that were found.

| Measure | Chesscog | Detector |
|---|---|---|
| Given perfect corners: wrong squares | 15.24% | 14.29% |
| Given perfect corners: boards with no errors | 0% | 0% |
| Given perfect corners: time per photo | ~1.5 s | ~0.2 s |
| Finding the board itself: boards found | 33.0% | 49.0% |
| Finding the board itself: wrong squares on found boards | 17.33% | 34.74% |
| Finding the board itself: boards with no errors | 0% | 0% |
| Finding the board itself: wrong squares across all photos, orientation counted | 81.08% | 71.90% |

Times were measured on a CPU, an Intel Core i7-10700.

## What went wrong

These figures come from the development photos, using the detector with perfect corners.

- **Finding pieces works.** Ignoring piece type, so reading each square as empty, white or black, it
  gets 4.13% of squares wrong. The boxes sit tightly on the pieces.
- **Naming pieces doesn't.** Without the height rule, 57% of the pieces it found had the wrong type.
  It called 68% of pawns bishops. It was trained on renders of a single chess set, which differs
  from the set in the photos.
- **The height rule helps, with a caveat.** Calling short pieces pawns took wrong squares from 19.5%
  to 12.8%. It was tuned on one chess set, and other sets may have different proportions.
- **Corners fail on real photos.** Only 1.8% of photos had all four corners within half a square of
  a detection. Chesscog's line-based method found a board in 33% of held-out photos.
- **Confidence can't be trusted yet.** On held-out photos with perfect corners, 99.67% of boards had
  errors the confidence flags didn't fully catch, so review flags would mislead.

## Limits of this test

- Every test photo shows one chess set, and the training renders show one other set. Results on
  other sets are unknown.
- The detector trained for 12 epochs (pieces) and 8 epochs (corners) on half the renders, on a CPU.
  More training on the same renders is unlikely to fix the piece types, since the gap is between
  rendered and real sets.

## Since the comparison (M4)

- **Corners are marked by the user.** Corner finding failed on real photos, so the user drags four
  markers onto the board, with an 8 by 8 grid drawn to check the fit. The service takes them as
  `?corners=` on the recognise request. This is switched off in the app unless opened with
  `?photos=1` or built with `VITE_PHOTO_CORNERS=1`.
- **The service reads photos itself,** with the detector exported to ONNX, so it needs no PyTorch.
  It also turns the board until White is at the bottom, which the comparison didn't attempt.
- **With the same detector, on development photos with true corners:** 15.16% of squares wrong,
  orientation included (36.64% before, when orientation was assumed). At the best rotation, 11.61%.
  Orientation right on 79.4% of boards. Flags caught 65.8% of wrong squares while flagging 32.9%.
- **Training on more chess sets:** eleven CC0 and CC BY 4.0 sets (see `third-party.md`) are
  rendered in Blender with made-up materials, boards and lighting: 3,850 images, mixed with 1,200 of
  chesscog's renders. The detector is fine-tuned from the first one for 12 epochs (`pieces-v2`).
- **With `pieces-v2`, same photos and corners:** 9.49% of squares wrong (95% interval 8.66% to
  10.43%), and 5.28% at the best rotation. Orientation is unchanged at 79.4%, so it is now the larger
  source of error. Flags caught 82.0% of wrong squares while flagging 21.3%, and boards silently
  wrong fell from 79.1% to 21.5%. Median time per photo was 169 ms; the 564 ms measured for the
  first detector, the same size of model, was taken while renders were running. The held-out photos
  have not been used yet.
- **The board's direction is now marked by the user.** Guessing it from where the pieces stand is
  wrong on 57 of the 330 development positions even with every piece read correctly, all of them
  endgames, some with confidence near 1. So after the corners, the user taps the edge White sits
  behind (sent as `white=x,y`), or says they aren't sure and the old guess is used.
- **With White's side marked, same photos and corners:** 5.28% of squares wrong (95% interval
  4.98% to 5.60%), direction right on every board. Flags caught 95.2% of wrong squares while
  flagging 7.7% of squares, and boards silently wrong fell to 13.9%. 4.8% of boards were read with
  no errors and 14.8% with at most one. Measured with `make_recognizer_with_white`, which stands in
  for a correct tap.
- **The pawn height rule is removed.** With `pieces-v2`, 615 of the 1,115 wrong squares were rooks
  the rule had turned into pawns, as ChessReD's rooks are squat. Without the rule, using the
  detector's own types, 1.61% of squares are wrong (95% interval 1.43% to 1.82%), 40.9% of boards
  are read with no errors and 72.7% with at most one. Raising the height cut or sparing rooks did no
  better than removing the rule. Flags now catch 76.0% of wrong squares while flagging only 1.8%,
  and 20.0% of boards are silently wrong, mostly from empty squares read as knights. Without
  White's side marked, 5.36% are wrong, as the direction is right on 83.3% of boards.
- **Squares below 80% confidence are now flagged,** up from 60%. Flags catch 92.4% of wrong squares
  while asking the user to check 3.0% of squares, about 2 a board, and 7.3% of boards are silently
  wrong. Flagging pieces that stand behind another, sit on the board's rim or share a square
  added little on top. Tuned on the development photos, so the held-out run is the real check.

### M4 results on held-out photos

Run once, after all the settings above were chosen, on the same 306 held-out photos as M3, with
true corners standing in for the user's taps. "White's side marked" stands in for a correct tap.

| Measure | M3 detector | M4, White's side marked | M4, direction guessed |
|---|---|---|---|
| Wrong squares, direction counted | Not measured | 1.69% (1.47% to 1.92%) | 2.63% (2.13% to 3.16%) |
| Wrong squares at the best rotation | 14.29% | 1.69% | 1.69% |
| Boards with no errors | 0% | 43.8% | 41.5% |
| Boards with at most one error | Not measured | 70.6% | 66.7% |
| Direction right | Not attempted | 100% | 95.4% |
| Wrong squares flagged | Not measured | 89.7% | 65.1% |
| Squares flagged | Not measured | 3.8% | 4.2% |
| Boards silently wrong | Not measured | 9.8% | 13.7% |

The held-out figures are close to the development ones, so the tuning didn't overfit those photos.
ChessReD shows one chess set and board, though, so other sets, lighting and phones are untested.

## Reproducing

```bash
pip install -e "ml[photo]"
python -m ptc_photo.build_rendered_yolo
python -m ptc_photo.train_detector pieces --epochs 12 --fraction 0.5
python -m ptc_photo.train_detector corners --epochs 8 --fraction 0.5
python -m ptc_eval run corpus/chessred2k --split holdout --recognizer ptc_photo.detector_pipeline:make_recognizer
```

For perfect corners, set `PTC_ORACLE_CORPUS=corpus/chessred2k` and use `make_oracle_recognizer`.
