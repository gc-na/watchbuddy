#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="${ROOT_DIR}/../watchbuddy-mvp.zip"

cd "$ROOT_DIR"
rm -f "$OUT_FILE"
zip -r "$OUT_FILE" . \
  -x './.git/*' \
  -x '*.DS_Store' \
  -x './node_modules/*' \
  -x './dist/*'

echo "Packaged $OUT_FILE"
