#!/bin/sh
# Verify a cosign signature. Refuses to pretend a check happened when no
# public key is configured. Nothing here pushes or deploys.
set -eu
image="${1:-}"
if [ -z "${COSIGN_PUBLIC_KEY:-}" ]; then
  echo "COSIGN_PUBLIC_KEY is unset; this step did not verify a signature" >&2
  exit 1
fi
if [ -z "$image" ]; then
  echo "usage: COSIGN_PUBLIC_KEY=cosign.pub scripts/verify/release/verify-sandbox-image-signature.sh <image ref>" >&2
  exit 1
fi
if ! command -v cosign >/dev/null 2>&1; then
  echo "cosign is not installed; the signature was not verified" >&2
  exit 1
fi
cosign verify --key "$COSIGN_PUBLIC_KEY" "$image"
