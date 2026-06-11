#!/bin/sh

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_BIN="$PROJECT_ROOT/.tools/node/bin"

if [ ! -x "$NODE_BIN/node" ] || [ ! -x "$NODE_BIN/npm" ]; then
  echo "Project-local Node.js/npm is missing. Run scripts/setup-macos.sh first." >&2
  exit 1
fi

export PATH="$NODE_BIN:$PATH"
cd "$PROJECT_ROOT"

