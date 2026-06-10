#!/usr/bin/env bash
# install-cline.sh — Downloads & installs the Cline VS Code extension into code-server
# Run this on first boot or during build to bundle Cline into the code-server image.
set -euo pipefail

CLINE_EXT_ID="saoudrizwan.claude-dev"
CLINE_VSIX_URL="https://open-vsx.org/api/${CLINE_EXT_ID}/latest/file/${CLINE_EXT_ID}.vsix"
CODE_SERVER_BIN="${CODE_SERVER_BIN:-code-server}"
VSIX_CACHE_DIR="${VSIX_CACHE_DIR:-/tmp/vsix-cache}"
INSTALL_DIR="${INSTALL_DIR:-$HOME}"

echo "=== Cline Installer for code-server ==="

mkdir -p "$VSIX_CACHE_DIR"

# 1. Try installing directly from Open VSX registry (preferred)
echo "[1/3] Attempting install from Open VSX registry..."
if ${CODE_SERVER_BIN} --install-extension "$CLINE_EXT_ID" 2>&1; then
  echo "✓ Cline installed from Open VSX registry"
  exit 0
fi

# 2. Fallback: Download VSIX and install from file
echo "[2/3] Registry install failed — downloading VSIX..."
VSIX_PATH="${VSIX_CACHE_DIR}/${CLINE_EXT_ID}.vsix"

if command -v curl &>/dev/null; then
  curl -fSL --connect-timeout 30 --max-time 120 \
    -o "$VSIX_PATH" "$CLINE_VSIX_URL"
elif command -v wget &>/dev/null; then
  wget --timeout=30 --tries=3 \
    -O "$VSIX_PATH" "$CLINE_VSIX_URL"
else
  echo "ERROR: Neither curl nor wget found." >&2
  exit 1
fi

if [[ ! -f "$VSIX_PATH" ]] || [[ ! -s "$VSIX_PATH" ]]; then
  echo "ERROR: VSIX download failed or file is empty." >&2
  exit 1
fi

echo "[3/3] Installing from VSIX file..."
${CODE_SERVER_BIN} --install-extension "$VSIX_PATH"

echo "✓ Cline installed successfully from VSIX"
