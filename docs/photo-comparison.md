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

## Reproducing

```bash
pip install -e "ml[photo]"
python -m ptc_photo.build_rendered_yolo
python -m ptc_photo.train_detector pieces --epochs 12 --fraction 0.5
python -m ptc_photo.train_detector corners --epochs 8 --fraction 0.5
python -m ptc_eval run corpus/chessred2k --split holdout --recognizer ptc_photo.detector_pipeline:make_recognizer
```

For perfect corners, set `PTC_ORACLE_CORPUS=corpus/chessred2k` and use `make_oracle_recognizer`.
