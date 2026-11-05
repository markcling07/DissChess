# Plan

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Licence | AGPL-3.0-or-later | Fits Chessground and Stockfish (GPL-3) and leaves Ultralytics (AGPL-3) available. A closed-source product would need a different board library, no Ultralytics, and legal advice on Stockfish |
| Delivery | Installable web app, then store apps by wrapping the same code with Capacitor | One codebase. iOS builds need a Mac or a cloud build service |
| Recognition location | Server-side, using CPU inference | Follows the Python and OpenCV stack and avoids slow phones. ONNX models leave on-device recognition open for later |
| Training | Colab or Kaggle notebooks run by the project owner | No local GPU, and no billing setup. Use a paid GPU if sessions prove too short |
| Hosting | Static host for the web app and any container host for the service, chosen later | No vendor lock-in |
| App look | The board colours of the owner's reference screenshot (`#eaedd1` and `#769556`) with Celtic pieces (MIT) | Closest set that can legally ship. The reference pieces look like Chess.com's Neo set, which is probably copyrighted |
| Recognition training | Licence-clean artwork, with non-commercial and site artwork used for testing only | Trained weights may count as derived from their data |
| Project location | `C:\dev\photo-to-chess` | OneDrive sync and locks interfere with `node_modules`, `.venv` and model weights |

## Behaviour the spec leaves open

- **Side to move:** nothing is preselected and the user must choose, unless a king in check settles it.
- **Castling:** rights are off by default and only offered when the king and rook are on their home squares. The exact starting position is the exception, with all four prefilled and visible.
- **Orientation:** the light-square rule (h1 is light) leaves two possible rotations. Piece placement or board labels usually settle it. When they don't, flag it and ask.
- **Illegal positions:** highlight the likely squares for the user to fix. Never correct them automatically.
- **Blunders and mistakes:** only scored on moves played in the session, because a single position has no history.
- **Tactics and mate threats:** labelled as engine-based heuristics.

## Milestones

| # | Milestone | Done when | Status |
|---|---|---|---|
| M0 | Repo, API contract, evaluation tool, labelled test image structure | Accuracy can be measured with one command | Done, with no engine or real images to measure yet |
| M1 | Game core, position editor, validation, manual setup, mobile-first UI, web app manifest | All rules pass tests from any FEN, with no recognition involved | Done. Touch dragging and real phones are still to check in M6 |
| M2 | Upload, camera, paste, secure intake, screenshot recognition | Target of at least 99.9% per square on themes kept out of training | Features built. **Target missed: 96.1% on held-out artwork.** 99.9% on calibration artwork. See the model's README |
| M3 | Photo model comparison: chesscog, a detector mapped through the board's perspective, and a corner model trained on ChessReD2K | A choice backed by numbers, and photo targets reset to what's achievable | |
| M4 | Photo recognition in production: training, calibration, orientation | Meets the M3 targets on chess sets kept out of training | |
| M5 | Stockfish play and analysis, with offline caching for both | Works from any reconstructed position | |
| M6 | Full error handling, service worker and install prompts, responsive UI, full test list, deployment docs | Every error case in the spec has a test, and it has been tried on real phones | |
| M7 | Capacitor wrapper, native camera, icons, store listings, submission | Accepted by both stores, after licensing advice | |

## Open items

- **M2 accuracy:** needs real screenshots to judge. The numbers so far are synthetic, and only one real screenshot has been tried. Old font-style piece sets are the weakest.
- **Silently wrong boards:** 6.5% on held-out artwork, or 1.1% on positions from play without the two weakest sets. Reduce this further before calling recognition reliable.
- **Dragged pieces:** a piece caught mid-drag in a screenshot isn't detected.
- **Camera:** tested only with a browser's fake camera. It needs HTTPS outside localhost, and it can't read real boards until M4.
- **Real test photos:** 30–50 labelled photos of chess sets the engine hasn't seen, needed by M3. This is the honest test of photo accuracy.
- **Licences to confirm before use:** ChessReD, each Roboflow dataset, and FastAPI (not listed on PyPI).
- **chesscog models:** confirm the pretrained downloads still work.
- **Docker:** not installed on the development machine, so Dockerfiles can't be tested there.
- **Keyboard play:** Chessground has no keyboard control of the board. The controls around it work by keyboard, but moving pieces doesn't. Address this in M6.
- **Touch dragging:** browser tests cover tapping on a phone and dragging with a mouse, but not dragging by touch. Try it on real phones in M6.
- **Chess.com screenshots:** testing only, never for training or shipping, because the piece art is proprietary.
