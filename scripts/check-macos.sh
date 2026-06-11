#!/bin/sh
set -e

. "$(dirname -- "$0")/project-env.sh"

echo "Node: $(node --version)"
echo "npm: $(npm --version)"
"$PROJECT_ROOT/.tools/yt-dlp" --version
"$PROJECT_ROOT/.tools/ffmpeg/bin/ffmpeg" -version | head -1
npm run check

