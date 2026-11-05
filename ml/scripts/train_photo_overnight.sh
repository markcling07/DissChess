#!/usr/bin/env bash
# Waits for the rendered dataset, checks it, converts it, then trains both detectors.
# Usage: bash ml/scripts/train_photo_overnight.sh <download log>
# Stops at the first failure, so it can't train on damaged or partial data.
set -euo pipefail

download_log="$1"
python=.venv/Scripts/python

echo "$(date) waiting for the download"
until grep -q 'train.z01$' "$download_log" 2>/dev/null; do sleep 60; done

bad=$(grep ' expected ' "$download_log" | awk '$1 != $3' | wc -l)
if [ "$bad" != "0" ]; then
  echo "$(date) checksum mismatch, stopping"
  grep ' expected ' "$download_log"
  exit 1
fi
echo "$(date) all checksums match"

"$python" -u -m ptc_photo.build_rendered_yolo
echo "$(date) converted: $(ls ml/data/yolo_pieces/images/train | wc -l) training images"

"$python" -u -W ignore -m ptc_photo.train_detector pieces --epochs 12 --fraction 0.5
echo "$(date) pieces finished"

"$python" -u -W ignore -m ptc_photo.train_detector corners --epochs 8 --fraction 0.5
echo "$(date) corners finished"
