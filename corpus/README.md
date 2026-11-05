# Test images

Each collection is a folder holding its images and a `manifest.jsonl`. Images are not committed, because they're large and have their own licences. `example/manifest.example.jsonl` shows the format.

```
corpus/
  my-photos/
    manifest.jsonl
    images/board-001.jpg
```

## Manifest fields

Each line of `manifest.jsonl` is one JSON object.

| Field | Required | Meaning |
|---|---|---|
| `id` | Yes | Unique within the collection |
| `image` | Yes | Relative path with forward slashes |
| `kind` | Yes | `screenshot` or `photo` |
| `set_id` | Yes | The physical chess set or digital theme |
| `split` | Yes | `dev` or `holdout` |
| `source` | Yes | Who took it, or where it came from |
| `license` | Yes | The terms it may be used under |
| `placement` | One of these two | The true position: the first field of a FEN, with rank 8 first, whichever way the board faces in the image |
| `expected_failure` | One of these two | The failure code for an image that should be refused, such as `no_board_detected` |
| `corners` | No | Four `{x, y}` points from 0 to 1, clockwise from the top left as seen in the image |
| `tags` | No | Free labels for the report, such as `angled`, `dim`, `wooden`, `endgame` |

## Rules that keep the numbers honest

- **Keep each set in one split.** Validation fails if a `set_id` appears in both `dev` and `holdout`. Otherwise holdout accuracy says nothing about chess sets the engine hasn't seen.
- **Only tune on `dev`.** Once `holdout` results have influenced a decision, they're no longer a fair test.
- **Label from the real position.** Check each label against the board itself, not against an engine's output.
- **Record the licence.** Chess.com screenshots and similar images are for testing only, and must not be used for training or shipped.

## Commands

```bash
pnpm eval validate corpus/my-photos
```

```bash
pnpm eval run corpus/my-photos --recognizer my_module:make_recognizer --split holdout
```

Add `--gate "square_error_overall<=0.001"` to fail the run when a target is missed. Keep the quotes, because shells treat an unquoted `<` as a redirect.
