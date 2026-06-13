#!/usr/bin/env bash
# preconfigure-cline.sh — Detects Aurora providers and configures Cline natively.
#
# Cline stores its provider configuration in:
#   ~/.cline/data/globalState.json       — provider mode & model selectors
#   ~/.cline/data/settings/providers.json — base URL, API key, model per provider
#   ~/.cline/data/secrets.json           — API keys (Cline reads them from here)
#
# Architecture (NO vscode-lm / Copilot):
#   Cline → native provider (deepseek/lmstudio/openai) → Aurora Gateway
#        → provider-specific endpoint (DeepSeek, LM Studio, etc.)
#
# Flow:
#   1. Query Aurora /api/v1/providers to detect which providers are available
#   2. Configure each available provider as a native Cline provider
#   3. Hide all unconfigured providers from Cline's dropdown
#
# Environment variables:
#   AURORA_GATEWAY_URL  — Aurora API base (default: http://host.docker.internal:3000)
#   CLINE_API_KEY       — API key for Aurora gateway (default: auto-generate JWT)
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
AURORA_GATEWAY_BASE="${AURORA_GATEWAY_BASE:-http://host.docker.internal:3000}"
AURORA_GATEWAY_URL="${AURORA_GATEWAY_URL:-${AURORA_GATEWAY_BASE}/api/v1}"
CLINE_DATA_DIR="${HOME}/.cline/data"
CLINE_API_KEY="${CLINE_API_KEY:-aurora-no-key}"

mkdir -p "${CLINE_DATA_DIR}/settings"

echo "=== Cline Native Provider Configuration ==="
echo "  Gateway:   $AURORA_GATEWAY_BASE"
echo "  Data dir:  $CLINE_DATA_DIR"

# ── Step 0: Generate JWT for Aurora auth ─────────────────────────────
if [ "$CLINE_API_KEY" = "aurora-no-key" ] && [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  CLINE_API_KEY="$DEEPSEEK_API_KEY"
  echo "  Using DEEPSEEK_API_KEY for Cline authentication"
fi

if [ "$CLINE_API_KEY" = "aurora-no-key" ]; then
  echo "  Generating JWT for Aurora user authentication..."
  CLINE_API_KEY=$(python3 -c "
import hmac, hashlib, base64, json, time

def b64url_encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

secret = b'aurora-dev-secret-change-in-production-minimum-32-chars'
header = {'alg':'HS256','typ':'JWT'}
payload = {
    'userId': 'b986d83c-65e3-4716-ab67-0c5354ca83fc',
    'email': 'james.branco@gmail.com',
    'role': 'admin',
    'iat': int(time.time()),
    'exp': int(time.time()) + 31536000
}
h = b64url_encode(json.dumps(header, separators=(',',':')).encode())
p = b64url_encode(json.dumps(payload, separators=(',',':')).encode())
msg = f'{h}.{p}'.encode()
sig = b64url_encode(hmac.new(secret, msg, hashlib.sha256).digest())
print(f'{h}.{p}.{sig}')
" 2>/dev/null)
  if [ -n "$CLINE_API_KEY" ]; then
    echo "  ✓ Generated JWT (expires in 365 days)"
  else
    echo "  ⚠ WARNING: Failed to generate JWT, using default key"
    CLINE_API_KEY="aurora-no-key"
  fi
fi

# ── Step 1: Detect available Aurora providers ─────────────────────────
echo ""
echo "[1/6] Detecting Aurora providers..."

PROVIDERS_JSON=""
if curl -s --max-time 5 "${AURORA_GATEWAY_BASE}/api/v1/providers" > /tmp/aurora-providers.json 2>/dev/null; then
  PROVIDERS_JSON=$(cat /tmp/aurora-providers.json)
  echo "  ✓ Fetched provider list from Aurora API"
else
  echo "  ⚠ Could not reach Aurora API — using env-var fallback"
  # Fallback: use env vars to determine providers
  cat > /tmp/aurora-providers.json << EOF
{
  "providers": {
    "deepseek": ${DEEPSEEK_API_KEY:+true}${DEEPSEEK_API_KEY:-false},
    "lmstudio": ${LMSTUDIO_URL:+true}${LMSTUDIO_URL:-false},
    "openai": ${OPENAI_API_KEY:+true}${OPENAI_API_KEY:-false},
    "anthropic": ${ANTHROPIC_API_KEY:+true}${ANTHROPIC_API_KEY:-false},
    "ollama": ${OLLAMA_BASE_URL:+true}${OLLAMA_BASE_URL:-false}
  },
  "models": {
    "deepseek": [{"id":"deepseek-chat","name":"DeepSeek Chat"},{"id":"deepseek-v4-pro","name":"DeepSeek V4 Pro"}],
    "lmstudio": [{"id":"qwen2.5-coder-7b","name":"qwen2.5-coder-7b"}],
    "openai": [],
    "anthropic": [],
    "ollama": []
  }
}
EOF
  PROVIDERS_JSON=$(cat /tmp/aurora-providers.json)
fi

# Parse provider availability & models
HAS_DEEPSEEK=$(echo "$PROVIDERS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d['providers'].get('deepseek') else 'false')")
HAS_LMSTUDIO=$(echo "$PROVIDERS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d['providers'].get('lmstudio') else 'false')")
HAS_OPENAI=$(echo "$PROVIDERS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d['providers'].get('openai') else 'false')")
HAS_ANTHROPIC=$(echo "$PROVIDERS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d['providers'].get('anthropic') else 'false')")
HAS_OLLAMA=$(echo "$PROVIDERS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d['providers'].get('ollama') else 'false')")

echo "  Providers detected:"
echo "    DeepSeek:  $HAS_DEEPSEEK"
echo "    LM Studio: $HAS_LMSTUDIO"
echo "    OpenAI:    $HAS_OPENAI"
echo "    Anthropic: $HAS_ANTHROPIC"
echo "    Ollama:    $HAS_OLLAMA"

# Pick default models from the API response
DEFAULT_DEEPSEEK_MODEL=$(echo "$PROVIDERS_JSON" | python3 -c "
import sys,json; d=json.load(sys.stdin)
models = d['models'].get('deepseek', [])
ids = [m['id'] for m in models]
preferred = next((m for m in ids if 'v4-pro' in m), None) or next((m for m in ids if 'deepseek-chat' in m), None) or (ids[0] if ids else 'deepseek-chat')
print(preferred)
")

DEFAULT_LMSTUDIO_MODEL=$(echo "$PROVIDERS_JSON" | python3 -c "
import sys,json; d=json.load(sys.stdin)
models = d['models'].get('lmstudio', [])
ids = [m['id'] for m in models]
preferred = next((m for m in ids if 'qwen' in m.lower() and 'coder' in m.lower()), None) or (ids[0] if ids else 'qwen2.5-coder-7b')
print(preferred)
")

DEFAULT_OPENAI_MODEL="gpt-4o"
DEFAULT_ANTHROPIC_MODEL="claude-4-sonnet-20250514"

echo "  Default models:"
echo "    DeepSeek:  $DEFAULT_DEEPSEEK_MODEL"
echo "    LM Studio: $DEFAULT_LMSTUDIO_MODEL"

# Compute LM Studio base URL (strip /v1 suffix — Cline appends api/v0/models itself)
LMSTUDIO_BASE="${LMSTUDIO_URL%/v1}"
LMSTUDIO_BASE="${LMSTUDIO_BASE%/v1/}"
if [ -z "$LMSTUDIO_BASE" ]; then
  LMSTUDIO_BASE="http://localhost:1234"
fi

# ── Step 2: Provider enum mapping (Cline uses int32 for planModeApiProvider) ──
# These MUST be numeric — Cline serializes planModeApiProvider as int32!
# Enum values from Cline source:
#   anthropic=0, openrouter=1, openai=4, ollama=5, lmstudio=6, gemini=7,
#   deepseek=11, vscode-lm=15, xai=21
declare -A PROVIDER_ENUM=(
  ["deepseek"]=11
  ["lmstudio"]=6
  ["openai"]=4
  ["ollama"]=5
  ["anthropic"]=0
)

# Primary: first available from [DeepSeek, LM Studio, OpenAI, Anthropic]
PRIMARY_PROVIDER=""          # string name for providers.json
PRIMARY_PROVIDER_ENUM=""     # int32 enum for globalState.json
PRIMARY_MODEL=""

if [ "$HAS_DEEPSEEK" = "true" ]; then
  PRIMARY_PROVIDER="deepseek"
  PRIMARY_PROVIDER_ENUM="${PROVIDER_ENUM[deepseek]}"
  PRIMARY_MODEL="$DEFAULT_DEEPSEEK_MODEL"
elif [ "$HAS_LMSTUDIO" = "true" ]; then
  PRIMARY_PROVIDER="lmstudio"
  PRIMARY_PROVIDER_ENUM="${PROVIDER_ENUM[lmstudio]}"
  PRIMARY_MODEL="$DEFAULT_LMSTUDIO_MODEL"
elif [ "$HAS_OPENAI" = "true" ]; then
  PRIMARY_PROVIDER="openai"
  PRIMARY_PROVIDER_ENUM="${PROVIDER_ENUM[openai]}"
  PRIMARY_MODEL="$DEFAULT_OPENAI_MODEL"
elif [ "$HAS_ANTHROPIC" = "true" ]; then
  PRIMARY_PROVIDER="anthropic"
  PRIMARY_PROVIDER_ENUM="${PROVIDER_ENUM[anthropic]}"
  PRIMARY_MODEL="$DEFAULT_ANTHROPIC_MODEL"
else
  echo "  ⚠ WARNING: No providers detected! Cline will have nothing to use."
  PRIMARY_PROVIDER="deepseek"
  PRIMARY_PROVIDER_ENUM="11"
  PRIMARY_MODEL="deepseek-chat"
fi

echo "  Primary:   $PRIMARY_PROVIDER (enum=$PRIMARY_PROVIDER_ENUM) / $PRIMARY_MODEL"

# ── Step 3: Build hidden providers list ────────────────────────────────
# All Cline native providers that could appear in the dropdown
ALL_CLINE_PROVIDERS="anthropic,openai,deepseek,lmstudio,gemini,xai,openrouter,ollama,requesty,hicap,baseten,vercel-ai-gateway"

# Build list of providers to HIDE (all minus the ones we have)
HIDDEN=""
for p in $(echo "$ALL_CLINE_PROVIDERS" | tr ',' ' '); do
  case "$p" in
    deepseek)  [ "$HAS_DEEPSEEK" = "true" ] && continue ;;
    lmstudio)  [ "$HAS_LMSTUDIO" = "true" ] && continue ;;
    openai)    [ "$HAS_OPENAI" = "true" ] && continue ;;
    anthropic) [ "$HAS_ANTHROPIC" = "true" ] && continue ;;
    ollama)    [ "$HAS_OLLAMA" = "true" ] && continue ;;
  esac
  HIDDEN="${HIDDEN}${HIDDEN:+,}$p"
done

echo "  Hidden providers: $HIDDEN"

# ── Step 4: Write secrets.json ─────────────────────────────────────────
echo ""
echo "[2/6] Writing Cline secrets..."

SECRETS_FILE="${CLINE_DATA_DIR}/secrets.json"
python3 -c "
import json, os
secrets = {}
path = '$SECRETS_FILE'
if os.path.exists(path):
    try:
        with open(path) as f:
            secrets = json.load(f)
    except:
        pass

# Write API key for every configured provider (Cline reads from secrets.json)
# All providers route through Aurora gateway, so same key works for all
secrets['deepSeekApiKey'] = '$CLINE_API_KEY'
secrets['lmStudioApiKey'] = '$CLINE_API_KEY'
secrets['openAiApiKey'] = '$CLINE_API_KEY'
secrets['apiKey'] = '$CLINE_API_KEY'

with open(path, 'w') as f:
    json.dump(secrets, f, indent=2)
print('  ✓ Written secrets.json')
"

# ── Step 5: Write providers.json ───────────────────────────────────────
echo ""
echo "[3/6] Writing Cline provider config..."

PROVIDERS_FILE="${CLINE_DATA_DIR}/settings/providers.json"
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || echo "2026-01-01T00:00:00.000Z")

python3 << PYEOF
import json, os

available = {}
if '${HAS_DEEPSEEK}' == 'true':
    available['deepseek'] = {
        'settings': {
            'provider': 'deepseek',
            'apiKey': '${CLINE_API_KEY}',
            'model': '${DEFAULT_DEEPSEEK_MODEL}',
            'baseUrl': None  # We patch the binary to use Aurora gateway
        },
        'updatedAt': '${CURRENT_TIME}',
        'tokenSource': 'manual'
    }

if '${HAS_LMSTUDIO}' == 'true':
    available['lmstudio'] = {
        'settings': {
            'provider': 'lmstudio',
            'lmStudioBaseUrl': '${LMSTUDIO_BASE}',
            'lmStudioModelId': '${DEFAULT_LMSTUDIO_MODEL}',
            'lmStudioApiKey': '${CLINE_API_KEY}',
            'lmStudioMaxTokens': 8192
        },
        'updatedAt': '${CURRENT_TIME}',
        'tokenSource': 'manual'
    }

if '${HAS_OPENAI}' == 'true':
    available['openai'] = {
        'settings': {
            'provider': 'openai',
            'apiKey': '${CLINE_API_KEY}',
            'openAiBaseUrl': '${AURORA_GATEWAY_URL}',
            'openAiModelId': '${DEFAULT_OPENAI_MODEL}'
        },
        'updatedAt': '${CURRENT_TIME}',
        'tokenSource': 'manual'
    }

if '${HAS_ANTHROPIC}' == 'true':
    available['anthropic'] = {
        'settings': {
            'provider': 'anthropic',
            'apiKey': '${CLINE_API_KEY}',
            'anthropicBaseUrl': '${AURORA_GATEWAY_URL}',
            'anthropicModelId': '${DEFAULT_ANTHROPIC_MODEL}'
        },
        'updatedAt': '${CURRENT_TIME}',
        'tokenSource': 'manual'
    }

if '${HAS_OLLAMA}' == 'true':
    available['ollama'] = {
        'settings': {
            'provider': 'ollama',
            'ollamaBaseUrl': '${AURORA_GATEWAY_BASE}'
        },
        'updatedAt': '${CURRENT_TIME}',
        'tokenSource': 'manual'
    }

config = {
    'version': 1,
    'lastUsedProvider': '${PRIMARY_PROVIDER}',
    'providers': available
}

with open('${PROVIDERS_FILE}', 'w') as f:
    json.dump(config, f, indent=2)
print('  ✓ Written providers.json with: ' + ', '.join(available.keys()))
PYEOF

# ── Step 6: Write globalState.json ─────────────────────────────────────
echo ""
echo "[4/6] Writing Cline global state..."

GLOBAL_STATE_FILE="${CLINE_DATA_DIR}/globalState.json"

python3 << PYEOF
import json, os

state = {}
path = '${GLOBAL_STATE_FILE}'
if os.path.exists(path):
    try:
        with open(path) as f:
            state = json.load(f)
    except:
        pass

# Core settings
state['welcomeViewCompleted'] = True
state['__vscodeMigrationVersion'] = state.get('__vscodeMigrationVersion', 1)
state['clineVersion'] = state.get('clineVersion', '3.89.2')

# Primary provider — use NATIVE provider enum (int32, NOT string!)
state['planModeApiProvider'] = ${PRIMARY_PROVIDER_ENUM}
state['actModeApiProvider'] = ${PRIMARY_PROVIDER_ENUM}
state['planActSeparateModelsSetting'] = False

# Provider-specific model IDs
if '${HAS_DEEPSEEK}' == 'true':
    state['deepseekBaseUrl'] = '${AURORA_GATEWAY_URL}'
    state['planModeDeepSeekModelId'] = '${DEFAULT_DEEPSEEK_MODEL}'
    state['actModeDeepSeekModelId'] = '${DEFAULT_DEEPSEEK_MODEL}'

if '${HAS_LMSTUDIO}' == 'true':
    state['lmStudioBaseUrl'] = '${LMSTUDIO_BASE}'
    state['planModeLmStudioModelId'] = '${DEFAULT_LMSTUDIO_MODEL}'
    state['actModeLmStudioModelId'] = '${DEFAULT_LMSTUDIO_MODEL}'
    state['lmStudioMaxTokens'] = 8192

if '${HAS_OPENAI}' == 'true':
    state['openAiBaseUrl'] = '${AURORA_GATEWAY_URL}'
    state['planModeOpenAiModelId'] = '${DEFAULT_OPENAI_MODEL}'
    state['actModeOpenAiModelId'] = '${DEFAULT_OPENAI_MODEL}'

if '${HAS_ANTHROPIC}' == 'true':
    state['anthropicBaseUrl'] = '${AURORA_GATEWAY_URL}'
    state['planModeAnthropicModelId'] = '${DEFAULT_ANTHROPIC_MODEL}'
    state['actModeAnthropicModelId'] = '${DEFAULT_ANTHROPIC_MODEL}'

with open(path, 'w') as f:
    json.dump(state, f, indent=2)
print('  ✓ Written globalState.json — primary: ${PRIMARY_PROVIDER} / ${PRIMARY_MODEL}')
PYEOF

# ── Step 7: Purge old caches and Copilot artifacts ─────────────────────
echo ""
echo "[5/6] Purging old caches and Copilot artifacts..."

# Purge Cline model caches
CLINE_CACHE_DIR="${HOME}/.local/share/code-server/User/globalStorage/saoudrizwan.claude-dev/cache"
mkdir -p "$CLINE_CACHE_DIR"
rm -f "$CLINE_CACHE_DIR/cline_models.json" \
      "$CLINE_CACHE_DIR/cline_recommended_models.json" \
      "$CLINE_CACHE_DIR/openrouter_models.json" \
      "$CLINE_CACHE_DIR/hicap_models.json" \
      "$CLINE_CACHE_DIR/vercel_ai_gateway_models.json" \
      2>/dev/null || true

# Purge old Cline tasks
CLINE_TASKS_DIR="${HOME}/.local/share/code-server/User/globalStorage/saoudrizwan.claude-dev/tasks"
if [ -d "$CLINE_TASKS_DIR" ]; then
  rm -rf "$CLINE_TASKS_DIR"/* 2>/dev/null || true
fi

# Remove Copilot chatLanguageModels.json (no longer used — not using vscode-lm)
rm -f "${HOME}/.local/share/code-server/User/chatLanguageModels.json" 2>/dev/null || true

# Remove old VS Code Cline settings
VSCODE_SETTINGS="${HOME}/.local/share/code-server/User/settings.json"
if [ -f "$VSCODE_SETTINGS" ] && command -v python3 &>/dev/null; then
  python3 -c "
import json
with open('$VSCODE_SETTINGS') as f:
    s = json.load(f)
removed = [k for k in s if k.startswith('cline.')]
for k in removed:
    del s[k]
if removed:
    with open('$VSCODE_SETTINGS', 'w') as f:
        json.dump(s, f, indent=4)
    print(f'  Removed stale VS Code settings: {removed}')
" 2>/dev/null || true
fi

# Clean Machine settings
MACHINE_SETTINGS="${HOME}/.local/share/code-server/Machine/settings.json"
if [ -f "$MACHINE_SETTINGS" ] && command -v python3 &>/dev/null; then
  python3 -c "
import json
with open('$MACHINE_SETTINGS') as f:
    s = json.load(f)
removed = [k for k in s if k.startswith('cline.')]
for k in removed:
    del s[k]
if removed:
    with open('$MACHINE_SETTINGS', 'w') as f:
        json.dump(s, f, indent=4)
    print(f'  Removed from Machine: {removed}')
" 2>/dev/null || true
fi

echo "  ✓ Caches purged, Copilot artifacts removed"

# ── Step 8: Patch Cline binary ─────────────────────────────────────────
echo ""
echo "[6/6] Patching Cline binary..."

CLINE_EXT_DIR="${HOME}/.local/share/code-server/extensions/saoudrizwan.claude-dev-3.89.2-universal"
EXT_JS="${CLINE_EXT_DIR}/dist/extension.js"

if [ -f "$EXT_JS" ]; then
  # Create backup if none exists
  [ -f "${EXT_JS}.orig" ] || cp "$EXT_JS" "${EXT_JS}.orig"

  # ── Provider hiding patch ──────────────────────────────────────────
  # Write hidden providers to a marker file that Cline reads via binary patch
  python3 << PYEOF
import json, os
hidden = '${HIDDEN}'.split(',') if '${HIDDEN}' else []
hidden_set = sorted(set(h for h in hidden if h))

if hidden_set:
    marker_dir = '${CLINE_DATA_DIR}'
    os.makedirs(marker_dir, exist_ok=True)
    with open(os.path.join(marker_dir, 'hidden_providers.json'), 'w') as f:
        json.dump({'hidden': hidden_set}, f, indent=2)
    print(f'  ✓ Written hidden_providers.json: {hidden_set}')
else:
    print('  No providers to hide')
PYEOF

  # ── URL patches (always applied) ───────────────────────────────────
  # Patch 1: Redirect DeepSeek base URL to Aurora gateway
  LC_ALL=C sed -i "s|https://api.deepseek.com/v1|${AURORA_GATEWAY_URL}|g" "$EXT_JS"

  # Patch 2: Change hardcoded default model kVr
  LC_ALL=C sed -i "s/kVr=\"claude-sonnet-4-5-20250929\"/kVr=\"${DEFAULT_DEEPSEEK_MODEL}\"/g" "$EXT_JS"
  LC_ALL=C sed -i "s/kVr=\"deepseek-chat\"/kVr=\"${DEFAULT_DEEPSEEK_MODEL}\"/g" "$EXT_JS"

  # Patch 3: LM Studio model listing fix
  # Cline uses "api/v0/models" by default which LM Studio supports natively.
  # Our previous api/v0→api/v1 patch BROKE this (LM Studio returns empty for /api/v1/models).
  # Restore: if the binary was previously patched, revert api/v1/models → api/v0/models.
  # Use Python bytearray since sed can't distinguish the two occurrences.
  python3 << PYEOF
import re

path = '${EXT_JS}'
with open(path, 'rb') as f:
    c = bytearray(f.read())

# We need to ensure api/v0/models is used (LM Studio supports it)
# Check if it was previously patched to api/v1/models
v1_count = c.count(b'api/v1/models')
v0_count = c.count(b'api/v0/models')

if v1_count > 0 and v0_count == 0:
    # Revert: api/v1/models → api/v0/models (same length, safe replacement)
    # This fixes LM Studio model listing
    c = c.replace(b'api/v1/models', b'api/v0/models')
    with open(path, 'wb') as f:
        f.write(c)
    print('  ✓ Restored api/v0/models for LM Studio compatibility')
elif v0_count > 0:
    print('  ✓ LM Studio model path already correct (api/v0/models)')
else:
    print('  ⚠ Warning: neither api/v0/models nor api/v1/models found')
PYEOF

  echo "  ✓ URL patches applied"
else
  echo "  ⚠ Cline extension not found at $EXT_JS — skipping binary patches"
fi

# ── Summary ────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Cline native provider configuration complete"
echo ""
echo "  Primary provider:  $PRIMARY_PROVIDER"
echo "  Primary model:     $PRIMARY_MODEL"
echo "  Gateway URL:       $AURORA_GATEWAY_URL"
echo "  Configured:        $(python3 -c "import json; d=json.load(open('$PROVIDERS_FILE')); print(','.join(d['providers'].keys()))" 2>/dev/null || echo 'none')"
echo "  Hidden:            $HIDDEN"
echo ""
echo "  Files written:"
echo "    $GLOBAL_STATE_FILE"
echo "    $PROVIDERS_FILE"
echo "    $SECRETS_FILE"
echo "    ${CLINE_DATA_DIR}/hidden_providers.json"
echo "═══════════════════════════════════════════════════════════════"
