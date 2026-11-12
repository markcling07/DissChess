#!/usr/bin/env bash
# Renders wood3d training images, adds them to the mixed dataset, fine-tunes pieces-v3 from v2,
# exports to ONNX and evaluates on the six wooden-board photos.
# Usage: bash ml/scripts/train_wood3d.sh [epochs]
set -euo pipefail

epochs="${1:-12}"
python=.venv/Scripts/python
export YOLO_AUTOINSTALL=false

echo "$(date) rendering wood3d images (8 samples, ~6-8 hours)..."
"$python" -u -m ptc_photo.render_many_sets --per-set 400 --style wood3d --samples 8
echo "$(date) renders finished"

echo "$(date) building dataset..."
"$python" -u -m ptc_photo.build_many_sets_yolo --chesscog 1200
echo "$(date) dataset built"

# Fine-tune from pieces-v2.
"$python" -u -W ignore -m ptc_photo.train_detector mixed --epochs "$epochs" --name mixed-v3 \
  --weights export/pieces-v2.pt
echo "$(date) training finished"

cp ml/data/runs/mixed-v3/weights/best.pt ml/data/export/pieces-v3.pt
"$python" -W ignore - <<'EOF'
from ultralytics import YOLO
print("exported", YOLO("ml/data/export/pieces-v3.pt").export(format="onnx", imgsz=640, simplify=False, opset=17))
EOF
echo "$(date) exported pieces-v3"

# Copy into the service and evaluate on the wooden-board test images.
cp ml/data/export/pieces-v3.onnx services/vision/src/ptc_vision/models/piece_detector.onnx
echo "$(date) done — run wood_baseline.py to measure"
