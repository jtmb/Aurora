#!/usr/bin/env bash
# scripts/entrypoint.sh — Master entrypoint for the bundled code-server + Cline + LM Studio setup
# Runs on container start or first boot.
# Order: install Cline → preconfigure for LM Studio → start code-server
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

# ── Step 2: Preconfigure Cline for LM Studio ─────────────────────────────
echo ""
echo "[2/5] Preconfiguring Cline for LM Studio..."
CODE_SERVER_DATA_DIR="$CODE_SERVER_DATA_DIR" \
  LMSTUDIO_URL="${LMSTUDIO_URL:-http://localhost:1234/v1}" \
  LMSTUDIO_MODEL="${LMSTUDIO_MODEL:-qwen-coder}" \
  CLINE_YOLO_MODE="${CLINE_YOLO_MODE:-true}" \
  bash "${SCRIPT_DIR}/preconfigure-cline.sh"

# ── Step 3: Preconfigure Copilot Chat for Aurora ───────────────────────
echo ""
echo "[3/5] Preconfiguring Copilot Chat for Aurora..."
CODE_SERVER_DATA_DIR="$CODE_SERVER_DATA_DIR" \
  AURORA_GATEWAY_URL="${AURORA_GATEWAY_URL:-http://172.19.0.1:3000/api/v1}" \
  AURORA_AUTH_TOKEN="${AURORA_AUTH_TOKEN:-}" \
  COPILOT_DEFAULT_MODEL="${COPILOT_DEFAULT_MODEL:-auto}" \
  DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}" \
  LMSTUDIO_URL="${LMSTUDIO_URL:-}" \
  LMSTUDIO_API_KEY="${LMSTUDIO_API_KEY:-}" \
  OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-}" \
  bash "${SCRIPT_DIR}/preconfigure-copilot.sh"

# ── Step 4: Install any additional extensions ────────────────────────────
echo ""
echo "[4/5] Installing additional bundled extensions..."
if [[ -n "${BUNDLED_EXTENSIONS:-}" ]]; then
  for ext in $BUNDLED_EXTENSIONS; do
    echo "  Installing: $ext"
    ${CODE_SERVER_BIN} --install-extension "$ext" || echo "  ⚠ Failed to install $ext"
  done
fi

# ── Step 5: Start code-server ────────────────────────────────────────────
echo ""
echo "[5/5] Starting code-server on port ${CODE_SERVER_PORT}..."
echo "  Data dir:   ${CODE_SERVER_DATA_DIR}"
echo "  Auth:       ${CODE_SERVER_AUTH:-password}"
echo "  LM Studio:  ${LMSTUDIO_URL:-http://localhost:1234/v1}"
echo "  Aurora GW:  ${AURORA_GATEWAY_URL:-http://host.docker.internal:3000/api/v1}"
echo ""

exec ${CODE_SERVER_BIN} \
  --bind-addr "0.0.0.0:${CODE_SERVER_PORT}" \
  --user-data-dir "${CODE_SERVER_DATA_DIR}" \
  ${CODE_SERVER_ARGS} \
  "$@"
