#!/bin/sh
set -e

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$PROJECT_ROOT/scripts/dev-macos.sh"
