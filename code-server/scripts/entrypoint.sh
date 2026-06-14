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

# ── Step 5b: Write argv.json — extension host heap limit ─────────────────
# code-server does NOT pass NODE_OPTIONS to the extension host process,
# so we must set --max-old-space-size via VS Code's argv.json mechanism.
# Without this, Cline 3.89.2 causes OOM crashes in the extension host.
ARGV_FILE="${CODE_SERVER_DATA_DIR}/argv.json"
MAX_MEMORY_MB="${CODE_SERVER_MAX_MEMORY:-6144}"
cat > "$ARGV_FILE" << EOF
{
    "max-memory": ${MAX_MEMORY_MB},
    "js-flags": "--max-old-space-size=${MAX_MEMORY_MB}"
}
EOF
echo "  ✓ Written argv.json (extension host max-old-space-size=${MAX_MEMORY_MB}MB)"

# ── Step 6: Move Cline to right secondary sidebar ───────────────────
# The VS Code web frontend uses browser IndexedDB for view container state,
# NOT the server-side SQLite state.vscdb. Writing views.customizations to
# SQLite has no effect on the browser frontend.
#
# Instead, we modify Cline's package.json to register its viewsContainers
# under "secondarySidebar" instead of "activitybar". This is the only
# reliable way to place a view container in the right sidebar.
echo ""
echo "[6/7] Moving Cline to right secondary sidebar..."
CLINE_PKG_DIR="${HOME}/.local/share/code-server/extensions/saoudrizwan.claude-dev-"*
CLINE_PKG="${CLINE_PKG_DIR}/package.json"
if [ -f "$CLINE_PKG" ]; then
  python3 -c "
import json, os

pkg_path = '${CLINE_PKG}'
with open(pkg_path, 'r') as f:
    pkg = json.load(f)

views_containers = pkg.get('contributes', {}).get('viewsContainers', {})
# Only change if still using activitybar
if 'activitybar' in views_containers:
    views_containers['secondarySidebar'] = views_containers.pop('activitybar')
    # Backup original if not already backed up
    bak_path = pkg_path + '.orig-sidebar'
    if not os.path.exists(bak_path):
        with open(bak_path, 'w') as bf:
            json.dump(pkg, bf, indent=2)  # write original before modification
    with open(pkg_path, 'w') as f:
        json.dump(pkg, f, indent=2)
    print('  ✓ Moved Cline viewsContainers from activitybar → secondarySidebar')
else:
    loc = 'secondarySidebar' if 'secondarySidebar' in views_containers else 'unknown'
    print(f'  ✓ Cline already in {loc}, no change needed')
"
else
  echo "  ⚠ Cline package.json not found at $CLINE_PKG"
fi
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
