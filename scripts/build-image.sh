#!/usr/bin/env bash
# Compatibility wrapper. The cross-platform production implementation lives in
# build-image.js so Windows deployment does not depend on WSL or Git Bash.
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

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/build-image.js" "$@"
