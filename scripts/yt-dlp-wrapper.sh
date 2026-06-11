#!/bin/sh

TOOLS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PYTHONPATH="$TOOLS_DIR/yt-dlp-python${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m yt_dlp "$@"
