# Third-party material

| Material | Used for | Author | Licence |
|---|---|---|---|
| Celtic pieces (`apps/web/src/pieces/celtic`) | Pieces shown in the app, with colour reduced by CSS | Maurizio Monge | MIT, in that folder's `LICENSE` |
| Chessground | The interactive board | Lichess contributors | GPL-3.0-or-later |
| Stockfish 19 Lite, via [stockfish.js](https://github.com/nmrugg/stockfish.js) 19.0.1 | Computer opponent and analysis, copied unchanged from the `stockfish` npm package into the built app | The Stockfish developers; Nathan Rugg | GPL-3.0, with the licence shipped beside the engine as `engine/COPYING.txt`. Source is at the links in this row and on the [Stockfish site](https://github.com/official-stockfish/Stockfish) |
| chess.js | Chess rules | Jeff Hlywa and contributors | BSD-2-Clause |
| Barlow, Patrick Hand | Fonts | Jeremy Tribby; Patrick Wagesreiter | SIL Open Font License |
| cburnett pieces (`apps/web/e2e/fixtures`) | Test images only | Colin M.L. Burnett | GPL-2.0-or-later |

## Artwork the model was trained on

The trained model in `services/vision/src/ptc_vision/models` may count as derived from this artwork. It was fetched from the lichess-org/lila repository, and licences are as stated in that repository's `COPYING.md`.

| Pieces | Author | Licence |
|---|---|---|
| cburnett | Colin M.L. Burnett | GPL-2.0-or-later |
| merida | Armando Hernandez Marroquin | GPL-2.0-or-later |
| mpchess | Maxime Chupin | GPL-3.0-or-later |
| pirouetti | pirouetti | AGPL-3.0-or-later |
| pixel | therealqtpi | AGPL-3.0-or-later |
| rhosgfx | RhosGFX | CC0-1.0 |
| fantasy, spatial | Maurizio Monge | MIT |
| totoy | Kosal Sen | CC BY 4.0 |
| papercut | Nikolay Anzarov | CC BY 4.0 |
| firi | James Faure | CC BY 4.0 |

Board textures from the same repository are by the lila authors and pirouetti, under AGPL-3.0-or-later. The model was calibrated on chessnut (Alexis Luengas, Apache-2.0) and celtic (Maurizio Monge, MIT), but not trained on them.

Other sets are used only to measure accuracy. They aren't committed, trained on or shipped.

## Photo recognition

Used in the M3 comparison and for training the photo detector. None of the material itself is
committed. The trained detector is, in `services/vision/src/ptc_vision/models/piece_detector.onnx`,
and may count as derived from the chesscog renders and the CC BY 4.0 sets below (so their authors
are credited here) and from the Ultralytics starting weights (AGPL-3.0).

| Material | Used for | Author | Licence |
|---|---|---|---|
| ChessReD2K | Testing only, never trained on | Masouris and van Gemert | CC BY-NC-SA 4.0 |
| Chesscog code and models | Baseline for comparison | Georg Wölflein | MIT |
| Chesscog rendered dataset | Training the detectors | Georg Wölflein and Ognjen Arandjelović | CC BY 4.0 |
| Ultralytics YOLO11n | Detector code and starting weights | Ultralytics | AGPL-3.0 |
| Blender 5.2.3 | Rendering training images. A tool only, not shipped | Blender Foundation | GPL-3.0-or-later |

### Chess sets rendered for training

CC BY 4.0 sets need their authors credited wherever the detector is distributed.

Only the piece shapes are used. Materials, boards and lighting are made up for each image by
`ml/src/ptc_photo/blender_render.py`, which also stretches each piece type a little.

| Set | Author | Licence |
|---|---|---|
| [3d chess pieces](https://opengameart.org/content/3d-chess-pieces) | tunakron | CC0 |
| [Chess board & pieces](https://opengameart.org/content/chess-board-pieces) | KillGorack | CC0 |
| [Chess Pieces](https://opengameart.org/content/chess-pieces-0) | Clint Bellanger | CC0 |
| [Chess Set](https://opengameart.org/content/chess-set-1) | rehcub | CC0 |
| [Chess](https://opengameart.org/content/chess) | pjhanzlik | CC0 |
| [Rough Chess Piece](https://opengameart.org/content/rough-chess-piece) | Lyricsz | CC0 |
| [Stylized Chess Pieces](https://opengameart.org/content/stylized-chess-pieces) | Lyricsz | CC0 |
| [Chess Board and Pieces](https://deplorablemountaineer.itch.io/chess-board-and-pieces) | deplorablemountaineer | CC0 |
| [Chess Pieces](https://opengameart.org/content/chess-pieces-5) | RayB2 | CC BY 4.0 |
| [Low Poly Chess Set](https://opengameart.org/content/low-poly-chess-set) | JustinARay | CC BY 4.0 |
| [Micro Staunton Chess Set](https://www.thingiverse.com/thing:1288929) | CMB27 | CC BY 4.0 |

Also downloaded but not used yet: [Chess Set](https://www.thingiverse.com/thing:4845987) by Stafford (CC BY 4.0), a minimalist modern design far from the Staunton shapes in most photos.
