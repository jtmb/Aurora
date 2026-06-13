#!/usr/bin/env bash
# preconfigure-copilot.sh — Injects Copilot Chat settings into code-server
# Points GitHub Copilot Chat at Aurora's API gateway so all models from Aurora
# are available inside the code-server Copilot Chat panel.
#
# Environment variables:
#   AURORA_GATEWAY_URL   — Aurora API gateway base (default: http://host.docker.internal:3000/api/v1)
#   AURORA_AUTH_TOKEN    — Optional JWT for API auth (default: empty)
#   COPILOT_DEFAULT_MODEL— Default model name (default: auto)
#   CODE_SERVER_DATA_DIR — code-server data dir (default: ~/.local/share/code-server)
set -euo pipefail

# --- Defaults ---
AURORA_GATEWAY_URL="${AURORA_GATEWAY_URL:-http://172.19.0.1:3000/api/v1}"
AURORA_AUTH_TOKEN="${AURORA_AUTH_TOKEN:-}"
COPILOT_DEFAULT_MODEL="${COPILOT_DEFAULT_MODEL:-auto}"
CODE_SERVER_DATA_DIR="${CODE_SERVER_DATA_DIR:-$HOME/.local/share/code-server}"

SETTINGS_DIR="${CODE_SERVER_DATA_DIR}/User"
SETTINGS_FILE="${SETTINGS_DIR}/settings.json"
GLOBAL_FILE="${CODE_SERVER_DATA_DIR}/Machine/settings.json"
WORKSPACE_SETTINGS_DIR="/workspace/.vscode"
WORKSPACE_SETTINGS_FILE="${WORKSPACE_SETTINGS_DIR}/settings.json"

echo "=== Copilot Chat Preconfiguration for Aurora ==="
echo "  Gateway URL:   $AURORA_GATEWAY_URL"
echo "  Default Model: $COPILOT_DEFAULT_MODEL"
echo "  Auth Token:    ${AURORA_AUTH_TOKEN:+***configured***}"
echo "  Settings dir:  $SETTINGS_DIR"

mkdir -p "$SETTINGS_DIR"
mkdir -p "$(dirname "$GLOBAL_FILE")"

# Strip trailing slash from gateway URL for consistency
AURORA_GATEWAY_URL="${AURORA_GATEWAY_URL%/}"

# --- Build Copilot Chat settings ---
# github.copilot.chat.models — custom model provider pointing at Aurora gateway.
# github.copilot.chat.agent.enabled — enable agent mode for tool execution.
# github.copilot.advanced.model.baseUrl — fallback override for model endpoint.
COPILOT_SETTINGS=$(cat <<EOF
{
  "github.copilot.chat.agent.enabled": true,
  "github.copilot.chat.models": [
    {
      "name": "Aurora Gateway",
      "model": "${COPILOT_DEFAULT_MODEL}",
      "baseUrl": "${AURORA_GATEWAY_URL}",
      "apiKey": "${AURORA_AUTH_TOKEN}",
      "provider": "openai"
    }
  ],
  "github.copilot.advanced": {
    "debug.overrideEngine": "${COPILOT_DEFAULT_MODEL}",
    "debug.overrideProxyUrl": "${AURORA_GATEWAY_URL}/chat/completions"
  }
}
EOF
)

# --- Merge into User settings.json ---
echo "Writing Copilot Chat settings to $SETTINGS_FILE..."
if [[ -f "$SETTINGS_FILE" ]]; then
  if command -v jq &>/dev/null; then
    MERGED=$(jq -s '.[0] * .[1]' "$SETTINGS_FILE" <(echo "$COPILOT_SETTINGS"))
    echo "$MERGED" > "$SETTINGS_FILE"
  elif command -v python3 &>/dev/null; then
    python3 -c "
import json, sys
try:
    with open('$SETTINGS_FILE') as f:
        existing = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    existing = {}
copilot = json.loads('''$COPILOT_SETTINGS''')
# Deep merge so we don't clobber nested objects like github.copilot.chat.models
for key, value in copilot.items():
    if key in existing and isinstance(existing[key], dict) and isinstance(value, dict):
        existing[key].update(value)
    else:
        existing[key] = value
with open('$SETTINGS_FILE', 'w') as f:
    json.dump(existing, f, indent=4)
"
  else
    echo "$COPILOT_SETTINGS" > "$SETTINGS_FILE"
    echo "⚠ Neither jq nor python3 found — settings file replaced entirely."
  fi
else
  echo "$COPILOT_SETTINGS" > "$SETTINGS_FILE"
fi

# --- Also write to Machine settings (global) so all users get it ---
cp "$SETTINGS_FILE" "$GLOBAL_FILE" 2>/dev/null || true

# --- Write workspace-level Copilot settings (picked up per-workspace) ---
mkdir -p "$WORKSPACE_SETTINGS_DIR"
if [[ -f "$WORKSPACE_SETTINGS_FILE" ]]; then
  if command -v jq &>/dev/null; then
    MERGED=$(jq -s '.[0] * .[1]' "$WORKSPACE_SETTINGS_FILE" <(echo "$COPILOT_SETTINGS"))
    echo "$MERGED" > "$WORKSPACE_SETTINGS_FILE"
  elif command -v python3 &>/dev/null; then
    python3 -c "
import json
try:
    with open('$WORKSPACE_SETTINGS_FILE') as f:
        existing = json.load(f)
except:
    existing = {}
copilot = json.loads('''$COPILOT_SETTINGS''')
for key, value in copilot.items():
    if key in existing and isinstance(existing[key], dict) and isinstance(value, dict):
        existing[key].update(value)
    else:
        existing[key] = value
with open('$WORKSPACE_SETTINGS_FILE', 'w') as f:
    json.dump(existing, f, indent=4)
"
  fi
else
  echo "$COPILOT_SETTINGS" > "$WORKSPACE_SETTINGS_FILE"
fi

# --- Build chatLanguageModels.json (Copilot Chat model catalog) ---
# This is the file Copilot Chat reads to populate its model picker.
# Models are discovered dynamically from Aurora's /api/providers/models endpoint.
# The API reads provider keys from the DB — no headers needed.
COPILOT_MODELS_FILE="${SETTINGS_DIR}/chatLanguageModels.json"
AURORA_CHAT_URL="${AURORA_GATEWAY_URL}/chat/completions"
echo ""
echo "Discovering models from Aurora API..."

# Fetch models from Aurora's dynamic models endpoint
# API base is gateway URL without /api/v1 (models endpoint is /api/providers/models)
AURORA_API_BASE="${AURORA_GATEWAY_URL%/api/v1}"
MODELS_JSON=$(curl -sS --max-time 30 "${AURORA_API_BASE}/api/providers/models" 2>/dev/null || echo '{"models":[]}')

# Validate we got JSON
if ! echo "$MODELS_JSON" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  echo "⚠ Warning: Failed to fetch models from Aurora API, using fallback"
  MODELS_JSON='{"models":[]}'
fi

# Use Python to build chatLanguageModels.json from the API response
echo "Writing Copilot Chat model catalog to $COPILOT_MODELS_FILE..."

# Write models JSON to temp file so Python can read it safely (avoids shell quoting)
MODELS_TMP=$(mktemp)
echo "$MODELS_JSON" > "$MODELS_TMP"

python3 << PYEOF
import json, os
from collections import OrderedDict

# Parse the models from the API (read from temp file, no shell quoting issues)
try:
    with open("${MODELS_TMP}") as f:
        api_data = json.load(f)
except (json.JSONDecodeError, FileNotFoundError):
    api_data = {"models": []}

api_models = api_data.get("models", [])

# Group models by provider (owned_by field)
provider_groups = OrderedDict()
seen_ids = set()

for m in api_models:
    model_id = m.get("id", "")
    source = m.get("source", m.get("owned_by", "Other"))
    if not model_id or model_id in seen_ids:
        continue
    seen_ids.add(model_id)

    provider_groups.setdefault(source, []).append({
        "id": model_id,
        "name": model_id,
        "url": "${AURORA_CHAT_URL}",
        "toolCalling": True,
        "vision": m.get("owned_by") == "openai",
        "maxInputTokens": 128000,
        "maxOutputTokens": 16000
    })

# Provider display names
PROVIDER_NAMES = {
    "DeepSeek": "DeepSeek",
    "OpenAI": "OpenAI",
    "Anthropic": "Anthropic",
    "LM Studio": "LM Studio",
    "Ollama": "Ollama",
}

# Build catalog with one group per provider + auto group first
catalog = []

# Auto group
catalog.append({
    "name": "Auto",
    "vendor": "customendpoint",
    "apiKey": "",
    "apiType": "chat-completions",
    "models": [{
        "id": "${COPILOT_DEFAULT_MODEL}",
        "name": "Auto (Best Available)",
        "url": "${AURORA_CHAT_URL}",
        "toolCalling": True,
        "vision": True,
        "maxInputTokens": 128000,
        "maxOutputTokens": 16000
    }]
})

# Provider groups
for source, models in provider_groups.items():
    display = PROVIDER_NAMES.get(source, source)
    catalog.append({
        "name": display,
        "vendor": "customendpoint",
        "apiKey": "",
        "apiType": "chat-completions",
        "models": models
    })

with open("${COPILOT_MODELS_FILE}", "w") as f:
    json.dump(catalog, f, indent=2)

total_models = 1 + sum(len(g) for g in provider_groups.values())
print(f"  Models discovered: {total_models} total across {len(provider_groups)} providers")
for entry in catalog:
    print(f"  [{entry['name']}]")
    for m in entry['models']:
        print(f"    • {m['id']}")
PYEOF

rm -f "$MODELS_TMP"

echo "✓ Copilot Chat preconfiguration complete."
echo "  Models endpoint: $AURORA_GATEWAY_URL"
echo "  Model catalog:   $COPILOT_MODELS_FILE"
echo "  Agent mode:      enabled"
