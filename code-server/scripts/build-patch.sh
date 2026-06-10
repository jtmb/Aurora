#!/usr/bin/env bash
# scripts/build-patch.sh — Patch for ci/build/build-release.sh in the code-server fork
# This script should be sourced or its logic integrated into the upstream build.
# It ensures Cline is bundled into the release artifact.
set -euo pipefail

echo "=== Bundling Cline into code-server build ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
VSIX_DEST_DIR="${VSIX_DEST_DIR:-$PROJECT_ROOT/release-standalone/extensions}"

mkdir -p "$VSIX_DEST_DIR"

# ── Download Cline VSIX for bundling ─────────────────────────────────────
CLINE_EXT_ID="saoudrizwan.claude-dev"
CLINE_VSIX_URL="https://open-vsx.org/api/${CLINE_EXT_ID}/latest/file/${CLINE_EXT_ID}.vsix"
VSIX_PATH="${VSIX_DEST_DIR}/${CLINE_EXT_ID}.vsix"

echo "Downloading Cline VSIX to $VSIX_PATH..."
curl -fSL --connect-timeout 30 --max-time 120 \
  -o "$VSIX_PATH" "$CLINE_VSIX_URL"

if [[ -f "$VSIX_PATH" ]] && [[ -s "$VSIX_PATH" ]]; then
  echo "✓ Cline VSIX downloaded ($(du -h "$VSIX_PATH" | cut -f1))"
else
  echo "⚠ Failed to download Cline VSIX — build will continue without it"
fi

# ── Copy orchestration scripts into the release ──────────────────────────
SCRIPTS_DEST="$PROJECT_ROOT/release-standalone/scripts"
mkdir -p "$SCRIPTS_DEST"

cp "$SCRIPT_DIR/entrypoint.sh" "$SCRIPTS_DEST/"
cp "$SCRIPT_DIR/install-cline.sh" "$SCRIPTS_DEST/"
cp "$SCRIPT_DIR/preconfigure-cline.sh" "$SCRIPTS_DEST/"

echo "✓ Orchestration scripts copied to $SCRIPTS_DEST"

# ── Patch code-server's startup to run our entrypoint ───────────────────
# This injects a call to our preconfiguration before the default startup.
# In practice, you'd modify the upstream ci/build/build-release.sh here.
echo ""
echo "=== Build patch complete ==="
echo "Next steps:"
echo "  1. Integrate this script into ci/build/build-release.sh"
echo "  2. Set ENTRYPOINT to scripts/entrypoint.sh in Dockerfile"
echo "  3. Build and test the release"
