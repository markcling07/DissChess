"""Trains the square classifier, calibrates it on unseen artwork, and exports it to ONNX.

Run: python -m ptc_train.train_squares
"""

import argparse
import json
import random
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from ptc_data.assets import DATA_DIR, PIECE_SETS, sets_in
from ptc_vision.classifier import MODEL_DIR, MODEL_NAME
from ptc_vision.tiles import LABELS, TILE_SIZE, to_model_input
from torch import nn
from torch.nn import functional as F

SEED = 20261105
# Of wrong answers on unseen artwork, the share the review threshold should catch.
TARGET_ERROR_RECALL = 0.97


class SquareNet(nn.Module):
    """Small enough to run in milliseconds on a CPU. A square holds one thing on a plain ground."""

    def __init__(self, classes: int = len(LABELS)):
        super().__init__()

        def block(a: int, b: int) -> nn.Sequential:
            return nn.Sequential(
                nn.Conv2d(a, b, 3, padding=1, bias=False),
                nn.BatchNorm2d(b),
                nn.ReLU(inplace=True),
                nn.Conv2d(b, b, 3, padding=1, bias=False),
                nn.BatchNorm2d(b),
                nn.ReLU(inplace=True),
                nn.MaxPool2d(2),
            )

        self.features = nn.Sequential(block(3, 24), block(24, 48), block(48, 96), block(96, 128))
        self.classifier = nn.Sequential(nn.Dropout(0.2), nn.Linear(128, classes))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.features(x).mean(dim=(2, 3)))


def augment(batch: torch.Tensor) -> torch.Tensor:
    """Changes in shade and framing. Colour order stays, as colour tells White from Black."""
    n = len(batch)
    gain = torch.empty(n, 3, 1, 1).uniform_(0.85, 1.15)
    brightness = torch.empty(n, 1, 1, 1).uniform_(0.8, 1.2)
    offset = torch.empty(n, 1, 1, 1).uniform_(-0.06, 0.06)
    batch = torch.clamp(batch * gain * brightness + offset, 0, 1)
    shift = int(torch.randint(-2, 3, (1,)))
    shift_y = int(torch.randint(-2, 3, (1,)))
    return torch.roll(batch, shifts=(shift_y, shift), dims=(2, 3))


def predict(model: nn.Module, tiles: np.ndarray, batch_size: int = 1024) -> torch.Tensor:
    model.eval()
    outputs = []
    with torch.no_grad():
        for start in range(0, len(tiles), batch_size):
            batch = torch.from_numpy(to_model_input(tiles[start : start + batch_size]))
            outputs.append(model(batch))
    return torch.cat(outputs)


def fit_temperature(logits: torch.Tensor, labels: torch.Tensor) -> float:
    log_temperature = torch.zeros(1, requires_grad=True)
    optimizer = torch.optim.LBFGS([log_temperature], lr=0.1, max_iter=100)

    def closure() -> torch.Tensor:
        optimizer.zero_grad()
        loss = F.cross_entropy(logits / log_temperature.exp(), labels)
        loss.backward()
        return loss

    optimizer.step(closure)
    return float(log_temperature.exp())


def choose_review_threshold(
    probabilities: torch.Tensor, labels: torch.Tensor
) -> tuple[float, dict]:
    """The lowest confidence cut-off that still catches the target share of wrong answers."""
    confidence, predicted = probabilities.max(dim=1)
    wrong = predicted != labels
    if int(wrong.sum()) == 0:
        return 0.9, {"errors": 0}
    wrong_confidence = confidence[wrong].sort().values
    index = min(len(wrong_confidence) - 1, int(TARGET_ERROR_RECALL * len(wrong_confidence)))
    # Kept between sensible bounds, since a few errors shouldn't move this very far.
    threshold = float(np.clip(float(wrong_confidence[index]) + 1e-4, 0.8, 0.9995))
    return threshold, {
        "errors": int(wrong.sum()),
        "error_recall": float((wrong_confidence < threshold).float().mean()),
        "flag_rate": float((confidence < threshold).float().mean()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--tiles", type=Path, default=DATA_DIR / "tiles")
    parser.add_argument("--version", default=datetime.now(UTC).strftime("%Y%m%d"))
    args = parser.parse_args()

    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(12)

    train_tiles = np.load(args.tiles / "train_tiles.npy", mmap_mode="r")
    train_labels = np.load(args.tiles / "train_labels.npy")
    calibration_tiles = np.load(args.tiles / "calibration_tiles.npy")
    calibration_labels = np.load(args.tiles / "calibration_labels.npy")
    print(f"Training on {len(train_labels)} tiles, calibrating on {len(calibration_labels)}")

    model = SquareNet()
    parameters = sum(p.numel() for p in model.parameters())
    counts = np.bincount(train_labels, minlength=len(LABELS)).astype(np.float64)
    weights = torch.tensor(np.sqrt(counts.mean() / counts), dtype=torch.float32)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    steps = args.epochs * (len(train_labels) // args.batch_size)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=3e-3, total_steps=steps)

    calibration_y = torch.from_numpy(calibration_labels.astype(np.int64))
    best_loss = float("inf")
    best_state = None
    best_epoch = 0
    history = []

    for epoch in range(1, args.epochs + 1):
        started = time.perf_counter()
        model.train()
        order = np.random.permutation(len(train_labels))
        total = 0.0
        batches = len(train_labels) // args.batch_size
        for batch_index in range(batches):
            chosen = np.sort(
                order[batch_index * args.batch_size : (batch_index + 1) * args.batch_size]
            )
            x = augment(torch.from_numpy(to_model_input(np.asarray(train_tiles[chosen]))))
            y = torch.from_numpy(train_labels[chosen].astype(np.int64))
            optimizer.zero_grad(set_to_none=True)
            loss = F.cross_entropy(model(x), y, weight=weights, label_smoothing=0.02)
            loss.backward()
            optimizer.step()
            scheduler.step()
            total += float(loss.detach())

        logits = predict(model, calibration_tiles)
        calibration_loss = float(F.cross_entropy(logits, calibration_y))
        accuracy = float((logits.argmax(dim=1) == calibration_y).float().mean())
        history.append({"epoch": epoch, "calibration_accuracy": accuracy, "loss": calibration_loss})
        print(
            f"epoch {epoch}: train loss {total / batches:.4f}, unseen-artwork accuracy "
            f"{accuracy:.4%}, loss {calibration_loss:.4f}, {time.perf_counter() - started:.0f}s",
            flush=True,
        )
        if calibration_loss < best_loss:
            best_loss = calibration_loss
            best_epoch = epoch
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    logits = predict(model, calibration_tiles)
    temperature = fit_temperature(logits, calibration_y)
    probabilities = F.softmax(logits / temperature, dim=1)
    threshold, threshold_stats = choose_review_threshold(probabilities, calibration_y)
    print(f"Best epoch {best_epoch}, temperature {temperature:.3f}, threshold {threshold:.4f}")
    print(threshold_stats)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    onnx_path = MODEL_DIR / f"{MODEL_NAME}.onnx"
    model.eval()
    example = torch.zeros(2, 3, TILE_SIZE, TILE_SIZE)
    torch.onnx.export(
        model,
        (example,),
        str(onnx_path),
        input_names=["tiles"],
        output_names=["logits"],
        dynamic_axes={"tiles": {0: "n"}, "logits": {0: "n"}},
        dynamo=False,
    )

    # The exported model must give the same answers as the one that was calibrated.
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    sample = to_model_input(calibration_tiles[:64])
    exported = session.run(None, {"tiles": sample})[0]
    difference = float(np.abs(exported - logits[:64].numpy()).max())
    if difference > 1e-3:
        raise RuntimeError(f"The exported model differs by {difference}")

    metadata = {
        "version": args.version,
        "labels": list(LABELS),
        "tile_size": TILE_SIZE,
        "temperature": temperature,
        "review_threshold": threshold,
        "parameters": parameters,
        "trained_on": {s: PIECE_SETS[s][1] for s in sets_in("train")},
        "calibrated_on": {s: PIECE_SETS[s][1] for s in sets_in("calibration")},
        "training_tiles": len(train_labels),
        "calibration_accuracy": float((logits.argmax(dim=1) == calibration_y).float().mean()),
        "threshold_stats": threshold_stats,
        "best_epoch": best_epoch,
        "history": history,
    }
    metadata_path = MODEL_DIR / f"{MODEL_NAME}.json"
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {onnx_path} ({onnx_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
