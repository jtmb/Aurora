#!/usr/bin/env bash
# preconfigure-cline.sh — Injects LM Studio + QWEN settings for Cline into code-server
# Writes VS Code settings so Cline is ready to use LM Studio out of the box.
# 
# Environment variables (all optional, with sane defaults):
#   LMSTUDIO_URL        — LM Studio API base (default: http://localhost:1234/v1)
#   LMSTUDIO_MODEL      — Model ID to use (default: qwen-coder)
#   CLINE_YOLO_MODE     — Enable headless auto-approve (default: false)
#   CLINE_MAX_TOKENS    — Max output tokens (default: 4096)
#   CLINE_TEMPERATURE   — Sampling temperature (default: 0.0)
#   CODE_SERVER_DATA_DIR — code-server data dir (default: ~/.local/share/code-server)
set -euo pipefail

# --- Defaults ---
LMSTUDIO_URL="${LMSTUDIO_URL:-http://localhost:1234/v1}"
LMSTUDIO_MODEL="${LMSTUDIO_MODEL:-qwen-coder}"
CLINE_YOLO_MODE="${CLINE_YOLO_MODE:-false}"
CLINE_MAX_TOKENS="${CLINE_MAX_TOKENS:-4096}"
CLINE_TEMPERATURE="${CLINE_TEMPERATURE:-0.0}"
CODE_SERVER_DATA_DIR="${CODE_SERVER_DATA_DIR:-$HOME/.local/share/code-server}"

SETTINGS_DIR="${CODE_SERVER_DATA_DIR}/User"
SETTINGS_FILE="${SETTINGS_DIR}/settings.json"
GLOBAL_FILE="${CODE_SERVER_DATA_DIR}/Machine/settings.json"

echo "=== Cline Preconfiguration for LM Studio ==="
echo "  LM Studio URL:    $LMSTUDIO_URL"
echo "  Model:            $LMSTUDIO_MODEL"
echo "  YOLO mode:        $CLINE_YOLO_MODE"
echo "  Settings dir:     $SETTINGS_DIR"

mkdir -p "$SETTINGS_DIR"
mkdir -p "$(dirname "$GLOBAL_FILE")"

# --- Build Cline settings ---
# These map to the settings that Cline reads on startup.
# Using openai-compatible provider pointing at LM Studio.
CLINE_SETTINGS=$(cat <<EOF
{
  "cline.apiProvider": "openai-compatible",
  "cline.openAiCompatibleBaseUrl": "${LMSTUDIO_URL}",
  "cline.openAiCompatibleModelId": "${LMSTUDIO_MODEL}",
  "cline.autoApprovalEnabled": ${CLINE_YOLO_MODE},
  "cline.maxTokens": ${CLINE_MAX_TOKENS},
  "cline.temperature": ${CLINE_TEMPERATURE},
  "cline.customInstructions": "You are an autonomous coding agent running in a code-server environment with full workspace access. Use available tools (read_file, write_to_file, execute_command, etc.) to complete the task. LM Studio provides your model backend at ${LMSTUDIO_URL}."
}
EOF
)

# --- Merge into User settings.json ---
echo "Writing Cline settings to $SETTINGS_FILE..."
if [[ -f "$SETTINGS_FILE" ]]; then
  # Use jq if available for clean merge, otherwise use python
  if command -v jq &>/dev/null; then
    MERGED=$(jq -s '.[0] * .[1]' "$SETTINGS_FILE" <(echo "$CLINE_SETTINGS"))
    echo "$MERGED" > "$SETTINGS_FILE"
  elif command -v python3 &>/dev/null; then
    python3 -c "
import json, sys
try:
    with open('$SETTINGS_FILE') as f:
        existing = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    existing = {}
cline = json.loads('''$CLINE_SETTINGS''')
existing.update(cline)
with open('$SETTINGS_FILE', 'w') as f:
    json.dump(existing, f, indent=4)
"
  else
    # Brute-force: just write Cline settings (will clobber other settings)
    echo "$CLINE_SETTINGS" > "$SETTINGS_FILE"
    echo "⚠ Neither jq nor python3 found — settings file replaced entirely."
  fi
else
  echo "$CLINE_SETTINGS" > "$SETTINGS_FILE"
fi

# --- Also write to Machine settings (global) so all users get it ---
cp "$SETTINGS_FILE" "$GLOBAL_FILE" 2>/dev/null || true

echo "✓ Cline preconfiguration complete."
echo "  Provider: openai-compatible → $LMSTUDIO_URL"
echo "  Model:    $LMSTUDIO_MODEL"
