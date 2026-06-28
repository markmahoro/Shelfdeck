#!/usr/bin/env bash
# Build the ShelfDeck service Docker image for linux/amd64 and export it as a
# tarball ready to ship to the NAS.
#
# Usage:
#   bash scripts/build-image.sh <tag>
#   bash scripts/build-image.sh v1.1.0
#
# Output:
#   dist-image/shelfdeck-<tag>.tar   (image tarball)
#
# The image is built from media-service/Dockerfile with the repository root as
# Docker context, so the service image can include the shared face-service.

set -euo pipefail

TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "Usage: bash scripts/build-image.sh <tag>   (e.g. v1.1.0)"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_NAME="markmahoro/shelfdeck"
OUT_DIR="$ROOT/dist-image"
TAR="$OUT_DIR/shelfdeck-$TAG.tar"

cd "$ROOT"

echo "==> Building $IMAGE_NAME:$TAG (linux/amd64) from repository root"
# Use the default builder (docker driver) which supports --output type=docker.
# --load would fail for cross-arch on the docker driver, so we build natively
# for the host arch (linux/amd64 here) and export a docker-format tar.
docker build \
  --platform linux/amd64 \
  -f media-service/Dockerfile \
  -t "$IMAGE_NAME:$TAG" \
  -t "$IMAGE_NAME:latest" \
  .

echo "==> Exporting image to $TAR"
mkdir -p "$OUT_DIR"
docker save -o "$TAR" "$IMAGE_NAME:$TAG" "$IMAGE_NAME:latest"

SIZE=$(du -h "$TAR" | cut -f1)
echo "==> Done. Image tar: $TAR ($SIZE)"
echo "    Next: scp to NAS and run scripts/deploy-nas.js"
