#!/usr/bin/env bash
# After render_many_sets: builds the mixed dataset, fine-tunes the piece detector, exports it to ONNX
# and measures it on the development photos with true corners. Never touches the held-out photos.
# Usage: bash ml/scripts/train_many_sets.sh [epochs]
set -euo pipefail

epochs="${1:-12}"
python=.venv/Scripts/python
export YOLO_AUTOINSTALL=false

"$python" -u -m ptc_photo.build_many_sets_yolo --chesscog 1200
echo "$(date) dataset built"

# Starts from the detector trained on chesscog's renders alone.
"$python" -u -W ignore -m ptc_photo.train_detector mixed --epochs "$epochs" --name mixed \
  --weights export/pieces-v1.pt
echo "$(date) training finished"

cp ml/data/runs/mixed/weights/best.pt ml/data/export/pieces-v2.pt
"$python" -W ignore - <<'EOF'
from ultralytics import YOLO

print("exported", YOLO("ml/data/export/pieces-v2.pt").export(format="onnx", imgsz=640, simplify=False, opset=17))
EOF
echo "$(date) exported"

# The service's own code, with true corners standing in for taps, on development photos only.
cp ml/data/export/pieces-v2.onnx services/vision/src/ptc_vision/models/piece_detector.onnx
PTC_ORACLE_CORPUS=corpus/chessred2k "$python" -W ignore -m ptc_eval run corpus/chessred2k \
  --split dev --recognizer ptc_photo.service_photo:make_recognizer \
  --output reports/photo-service-v2-dev.json
echo "$(date) evaluated"
