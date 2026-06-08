#!/bin/bash
# Aurora — Full reset script
# Wipes: SQLite DB, filesystem workspaces, and prints localStorage clear instructions
# Usage: ./wipe.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="$SCRIPT_DIR/apps/web/aurora.db"
WORKSPACES_DIR="$HOME/.aurora/workspaces"

echo "=== Aurora Wipe ==="
echo ""

# 1. Kill dev server
echo "[1/4] Stopping dev server..."
pkill -f "next dev" 2>/dev/null && echo "  ✓ Dev server killed" || echo "  - No dev server running"
sleep 1

# 2. Wipe SQLite database
echo "[2/4] Wiping database..."
if [ -f "$DB_PATH" ]; then
  rm -f "$DB_PATH"
  echo "  ✓ Removed: $DB_PATH"
else
  echo "  - No database found at $DB_PATH"
fi

# 3. Wipe filesystem workspaces
echo "[3/4] Wiping workspaces..."
if [ -d "$WORKSPACES_DIR" ]; then
  COUNT=$(ls "$WORKSPACES_DIR" 2>/dev/null | wc -l)
  rm -rf "$WORKSPACES_DIR"/*
  echo "  ✓ Removed $COUNT workspace(s) from $WORKSPACES_DIR"
else
  echo "  - No workspaces directory found"
fi

# 4. Browser localStorage reminder
echo "[4/4] Browser localStorage — you must clear this manually:"
echo ""
echo "  In your browser dev tools (F12 → Console), run:"
echo ""
echo "    localStorage.clear(); location.reload();"
echo ""
echo "  Or open an incognito/private window for a truly fresh session."
echo ""
echo "=== Done! Run 'npm run dev' in apps/web/ to restart ==="
