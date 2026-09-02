#!/bin/sh
# Generates the test fixture if missing. Requires ffmpeg.
set -e
out="$(dirname "$0")/fixtures/sample.mp4"
[ -f "$out" ] && { echo "fixture exists: $out"; exit 0; }
mkdir -p "$(dirname "$out")"
ffmpeg -loglevel error -y \
  -f lavfi -i testsrc=size=320x240:rate=25 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$out"
echo "wrote $out"
