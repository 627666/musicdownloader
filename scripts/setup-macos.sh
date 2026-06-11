#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TOOLS_DIR="$PROJECT_ROOT/.tools"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

case "$(uname -m)" in
  arm64) NODE_ARCH=arm64 ;;
  x86_64) NODE_ARCH=x64 ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$TOOLS_DIR"

curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$TMP_DIR/node-shasums.txt"
NODE_ARCHIVE=$(awk -v arch="$NODE_ARCH" '$2 ~ ("node-v22.*-darwin-" arch "\\.tar\\.gz$") {print $2; exit}' "$TMP_DIR/node-shasums.txt")
curl -fL "https://nodejs.org/dist/latest-v22.x/$NODE_ARCHIVE" -o "$TMP_DIR/$NODE_ARCHIVE"
EXPECTED=$(awk -v file="$NODE_ARCHIVE" '$2 == file {print $1}' "$TMP_DIR/node-shasums.txt")
ACTUAL=$(shasum -a 256 "$TMP_DIR/$NODE_ARCHIVE" | awk '{print $1}')
[ "$EXPECTED" = "$ACTUAL" ]
rm -rf "$TOOLS_DIR/node"
mkdir -p "$TOOLS_DIR/node"
tar -xzf "$TMP_DIR/$NODE_ARCHIVE" --strip-components=1 -C "$TOOLS_DIR/node"

rm -rf "$TOOLS_DIR/yt-dlp-python"
python3 -m pip install --disable-pip-version-check --target "$TOOLS_DIR/yt-dlp-python" yt-dlp
cp "$PROJECT_ROOT/scripts/yt-dlp-wrapper.sh" "$TOOLS_DIR/yt-dlp"
chmod +x "$TOOLS_DIR/yt-dlp"

mkdir -p "$TOOLS_DIR/ffmpeg/bin"
python3 -m pip install --disable-pip-version-check --target "$TMP_DIR/imageio-ffmpeg" imageio-ffmpeg
cp "$TMP_DIR"/imageio-ffmpeg/imageio_ffmpeg/binaries/ffmpeg-* "$TOOLS_DIR/ffmpeg/bin/ffmpeg"
chmod +x "$TOOLS_DIR/ffmpeg/bin/ffmpeg"

PATH="$TOOLS_DIR/node/bin:$PATH"
cd "$PROJECT_ROOT"
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

echo "Setup complete. Run scripts/check-macos.sh to verify the environment."
