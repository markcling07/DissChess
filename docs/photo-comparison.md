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

## Reproducing

```bash
pip install -e "ml[photo]"
python -m ptc_photo.build_rendered_yolo
python -m ptc_photo.train_detector pieces --epochs 12 --fraction 0.5
python -m ptc_photo.train_detector corners --epochs 8 --fraction 0.5
python -m ptc_eval run corpus/chessred2k --split holdout --recognizer ptc_photo.detector_pipeline:make_recognizer
```

For perfect corners, set `PTC_ORACLE_CORPUS=corpus/chessred2k` and use `make_oracle_recognizer`.
