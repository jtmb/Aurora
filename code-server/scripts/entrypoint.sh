#!/usr/bin/env bash
# scripts/entrypoint.sh — Master entrypoint for the bundled code-server + Cline setup
# Runs on container start or first boot.
# Order: install Cline → preconfigure via Aurora → start code-server
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODE_SERVER_BIN="${CODE_SERVER_BIN:-code-server}"
CODE_SERVER_PORT="${CODE_SERVER_PORT:-8080}"
CODE_SERVER_DATA_DIR="${CODE_SERVER_DATA_DIR:-$HOME/.local/share/code-server}"
CODE_SERVER_ARGS="${CODE_SERVER_ARGS:---disable-telemetry --disable-update-check}"

echo "╔══════════════════════════════════════════════════════╗"
echo "║   Autonomous App Builder — Bootstrapping            ║"
echo "╚══════════════════════════════════════════════════════╝"

# ── Step 1: Install Cline extension ──────────────────────────────────────
echo ""
echo "[1/5] Installing Cline VS Code extension..."
bash "${SCRIPT_DIR}/install-cline.sh"

# ── Step 2: Preconfigure Cline via Aurora gateway ────────────────────────
echo ""
echo "[2/5] Detecting Aurora providers & configuring Cline natively..."
CODE_SERVER_DATA_DIR="$CODE_SERVER_DATA_DIR" \
  AURORA_GATEWAY_URL="${AURORA_GATEWAY_URL:-http://host.docker.internal:3000/api/v1}" \
  CLINE_API_KEY="${CLINE_API_KEY:-aurora-no-key}" \
  DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}" \
  LMSTUDIO_URL="${LMSTUDIO_URL:-}" \
  LMSTUDIO_API_KEY="${LMSTUDIO_API_KEY:-}" \
  OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
  OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-}" \
  bash "${SCRIPT_DIR}/preconfigure-cline.sh"

# ── Step 3: Install provider filter hook ─────────────────────────────────
echo ""
echo "[3/5] Installing Cline provider filter hook..."
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require ${SCRIPT_DIR}/cline-provider-filter.cjs"
echo "  NODE_OPTIONS=$NODE_OPTIONS"

# ── Step 4: Install any additional extensions ────────────────────────────
echo ""
echo "[4/6] Installing additional bundled extensions..."
if [[ -n "${BUNDLED_EXTENSIONS:-}" ]]; then
  for ext in $BUNDLED_EXTENSIONS; do
    echo "  Installing: $ext"
    ${CODE_SERVER_BIN} --install-extension "$ext" || echo "  ⚠ Failed to install $ext"
  done
fi

# ── Step 5: Write default Machine settings ───────────────────────────────
echo ""
echo "[5/7] Writing default Machine settings..."
MACHINE_SETTINGS_DIR="${CODE_SERVER_DATA_DIR}/Machine"
MACHINE_SETTINGS_FILE="${MACHINE_SETTINGS_DIR}/settings.json"
mkdir -p "$MACHINE_SETTINGS_DIR"

if [ -f "$MACHINE_SETTINGS_FILE" ]; then
  python3 -c "
import json, sys
with open('$MACHINE_SETTINGS_FILE', 'r') as f:
    s = json.load(f)
s['chat.disableAIFeatures'] = True
s['workbench.colorTheme'] = 'Dark 2026'
with open('$MACHINE_SETTINGS_FILE', 'w') as f:
    json.dump(s, f, indent=4)
" && echo "  ✓ Updated existing Machine settings with defaults"
else
  cat > "$MACHINE_SETTINGS_FILE" << 'EOF'
{
    "chat.disableAIFeatures": true,
    "workbench.colorTheme": "Dark 2026"
}
EOF
  echo "  ✓ Created Machine settings with defaults"
fi

# ── Step 6: Pre-populate global state (Cline → secondary sidebar) ───────
echo ""
echo "[6/7] Pre-populating global state defaults..."
STATE_DB_DIR="${CODE_SERVER_DATA_DIR}/User/globalStorage"
STATE_DB_FILE="${STATE_DB_DIR}/state.vscdb"
mkdir -p "$STATE_DB_DIR"
python3 -c "
import sqlite3, json, os

db_path = '$STATE_DB_FILE'
conn = sqlite3.connect(db_path)
conn.execute('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')

# Set Cline view container → secondary (right) sidebar
c = conn.execute(\"SELECT value FROM ItemTable WHERE key='viewContainerLocation'\")
row = c.fetchone()
locations = json.loads(row[0]) if row and row[0] else {}
locations['claude-dev-ActivityBar'] = 'secondarySideBar'
conn.execute(\"INSERT OR REPLACE INTO ItemTable(key, value) VALUES('viewContainerLocation', ?)\",
             (json.dumps(locations),))

c = conn.execute(\"SELECT value FROM ItemTable WHERE key='views.cachedViewContainerLocations'\")
row = c.fetchone()
cached = json.loads(row[0]) if row and row[0] else {}
cached['claude-dev-ActivityBar'] = 'secondarySideBar'
conn.execute(\"INSERT OR REPLACE INTO ItemTable(key, value) VALUES('views.cachedViewContainerLocations', ?)\",
             (json.dumps(cached),))

conn.commit()
conn.close()
" && echo "  ✓ Cline set to open in secondary (right) sidebar"
echo ""

# ── Step 7: Start code-server ────────────────────────────────────────────
echo ""
echo "[7/7] Starting code-server on port ${CODE_SERVER_PORT}..."
echo "  Data dir:   ${CODE_SERVER_DATA_DIR}"
echo "  Auth:       ${CODE_SERVER_AUTH:-password}"
echo "  Aurora GW:  ${AURORA_GATEWAY_URL:-http://host.docker.internal:3000/api/v1}"
echo ""

exec ${CODE_SERVER_BIN} \
  --bind-addr "0.0.0.0:${CODE_SERVER_PORT}" \
  --user-data-dir "${CODE_SERVER_DATA_DIR}" \
  ${CODE_SERVER_ARGS} \
  "$@"
