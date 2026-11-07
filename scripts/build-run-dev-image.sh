#!/bin/sh
# Build the coding run image (deploy/run-dev/Dockerfile) as a local OCI
# archive, on top of a run image (deploy/run/Dockerfile) the builder can
# read. This script never pushes. A registry publish (digest pin, signature,
# scan, runs.allowedImages) is an operator step, from a controlled registry.
#
#   scripts/build-run-dev-image.sh [dest] [run-image]
#   default: dist/sagax-run-dev.oci on sagax-run:local, for linux/amd64 (the
#   runs node pool). RUN_IMAGE_PLATFORMS overrides the platforms.
set -eu
if [ "${RUN_IMAGE_PUSH:-}" = "1" ] || [ "${SANDBOX_IMAGE_PUSH:-}" = "1" ]; then
  echo "run-dev image build refuses a push: this script never pushes" >&2
  exit 1
fi
dest="${1:-dist/sagax-run-dev.oci}"
run_image="${2:-sagax-run:local}"
platforms="${RUN_IMAGE_PLATFORMS:-linux/amd64}"
mkdir -p "$(dirname "$dest")"
docker buildx build \
  --platform "${platforms}" \
  --build-arg "RUN_IMAGE=${run_image}" \
  -f deploy/run-dev/Dockerfile \
  -o "type=oci,dest=${dest}" \
  .
echo "wrote ${dest} (not pushed, not signed, not scanned)"
