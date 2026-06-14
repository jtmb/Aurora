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

# ── Step 0: Use env-var API keys (no hardcoded user JWT) ──────────────────
# Per-user provider isolation happens at the Aurora gateway level.
# Cline uses the actual provider API keys from env vars, not a shared JWT.
# When a user authenticates through the Aurora front-end, the gateway
# applies per-user restrictions on top of the provider keys.
if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  CLINE_API_KEY="$DEEPSEEK_API_KEY"
  echo "  Using DEEPSEEK_API_KEY for Cline authentication"
elif [ -n "${OPENAI_API_KEY:-}" ]; then
  CLINE_API_KEY="$OPENAI_API_KEY"
  echo "  Using OPENAI_API_KEY for Cline authentication"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  CLINE_API_KEY="$ANTHROPIC_API_KEY"
  echo "  Using ANTHROPIC_API_KEY for Cline authentication"
else
  echo "  ⚠ WARNING: No API key env vars set — Cline will have no auth"
  CLINE_API_KEY="aurora-no-key"
fi

# ── Step 1: Detect available Aurora providers ─────────────────────────
echo ""
echo "[1/6] Detecting Aurora providers..."

PROVIDERS_JSON=""
PROVIDERS_TMP="${CLINE_DATA_DIR}/providers-tmp.json"
if curl -s --max-time 5 "${AURORA_GATEWAY_BASE}/api/v1/providers" > "$PROVIDERS_TMP" 2>/dev/null; then
  PROVIDERS_JSON=$(cat "$PROVIDERS_TMP")
  echo "  ✓ Fetched provider list from Aurora API"
else
  echo "  ⚠ Could not reach Aurora API — using env-var fallback"
  # Fallback: use env vars to determine providers
  cat > "$PROVIDERS_TMP" << EOF
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

# ── Step 2: Primary provider selection ───────────────────────────────────
# Primary: first available from [DeepSeek, LM Studio, OpenAI, Anthropic]
PRIMARY_PROVIDER=""          # string name for both globalState.json and providers.json
PRIMARY_MODEL=""

if [ "$HAS_DEEPSEEK" = "true" ]; then
  PRIMARY_PROVIDER="deepseek"
  PRIMARY_MODEL="$DEFAULT_DEEPSEEK_MODEL"
elif [ "$HAS_LMSTUDIO" = "true" ]; then
  PRIMARY_PROVIDER="lmstudio"
  PRIMARY_MODEL="$DEFAULT_LMSTUDIO_MODEL"
elif [ "$HAS_OPENAI" = "true" ]; then
  PRIMARY_PROVIDER="openai"
  PRIMARY_MODEL="$DEFAULT_OPENAI_MODEL"
elif [ "$HAS_ANTHROPIC" = "true" ]; then
  PRIMARY_PROVIDER="anthropic"
  PRIMARY_MODEL="$DEFAULT_ANTHROPIC_MODEL"
else
  echo "  ⚠ WARNING: No providers detected! Cline will have nothing to use."
  PRIMARY_PROVIDER="deepseek"
  PRIMARY_MODEL="deepseek-chat"
fi

echo "  Primary:   $PRIMARY_PROVIDER / $PRIMARY_MODEL"

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

# Build VISIBLE list for JavaScript array (comma-separated quoted names)
VISIBLE_PROVIDERS=""
for p in $(echo "$ALL_CLINE_PROVIDERS" | tr ',' ' '); do
  case "$p" in
    deepseek)  [ "$HAS_DEEPSEEK" = "true" ] || continue ;;
    lmstudio)  [ "$HAS_LMSTUDIO" = "true" ] || continue ;;
    openai)    [ "$HAS_OPENAI" = "true" ] || continue ;;
    anthropic) [ "$HAS_ANTHROPIC" = "true" ] || continue ;;
    ollama)    [ "$HAS_OLLAMA" = "true" ] || continue ;;
    *) continue ;;
  esac
  VISIBLE_PROVIDERS="${VISIBLE_PROVIDERS}${VISIBLE_PROVIDERS:+,}\"$p\""
done
echo "  Visible providers: $VISIBLE_PROVIDERS"

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

# Primary provider — use STRING name, not int32 (Cline maps strings internally)
state['planModeApiProvider'] = '${PRIMARY_PROVIDER}'
state['actModeApiProvider'] = '${PRIMARY_PROVIDER}'
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

# Browser settings — enable browser tool by default with Chromium
if 'browserSettings' not in state:
    state['browserSettings'] = {}
state['browserSettings']['disableToolUse'] = False
state['browserSettings']['remoteBrowserEnabled'] = False
state['browserSettings']['chromeExecutablePath'] = '/usr/bin/chromium'
state['browserSettings'].setdefault('viewport', {'width': 900, 'height': 600})
state['browserSettings'].setdefault('customArgs', '')

# Auto-approval — allow browser usage
if 'autoApprovalSettings' not in state:
    state['autoApprovalSettings'] = {}
state['autoApprovalSettings']['enabled'] = True
if 'actions' not in state['autoApprovalSettings']:
    state['autoApprovalSettings']['actions'] = {}
state['autoApprovalSettings']['actions']['useBrowser'] = True

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
  # Strategy: Prepend a require() call to extension.js that loads our
  # monkey-patch hook. The hook patches getRemoteConfigSettings() to inject
  # remoteConfiguredProviders from hidden_providers.json at runtime.
  # This works regardless of whether NODE_OPTIONS propagates to the extension host.
  python3 << PYEOF
import json, os

hidden = '${HIDDEN}'.split(',') if '${HIDDEN}' else []
hidden_set = sorted(set(h for h in hidden if h))
visible = sorted(set(['deepseek','lmstudio','openai','anthropic','ollama']) - set(hidden_set))
visible = [v for v in ['deepseek','lmstudio','openai','anthropic','ollama'] if v not in hidden_set]

marker_dir = '${CLINE_DATA_DIR}'
os.makedirs(marker_dir, exist_ok=True)

# Write hidden_providers.json with remoteConfiguredProviders (visible list)
with open(os.path.join(marker_dir, 'hidden_providers.json'), 'w') as f:
    json.dump({'remoteConfiguredProviders': visible}, f, indent=2)
print(f'  ✓ Written hidden_providers.json: visible={visible}, hidden={hidden_set}')

# Prepend require() hook to extension.js
ext_path = '${EXT_JS}'
hook_path = '/opt/aurora/scripts/cline-provider-filter.cjs'

if os.path.exists(hook_path):
    with open(ext_path, 'rb') as f:
        original = f.read()
    
    # Only prepend if not already prepended
    if not original.startswith(b'require("/opt/aurora/scripts/cline-provider-filter.cjs")'):
        prepend = b'require("/opt/aurora/scripts/cline-provider-filter.cjs");'
        with open(ext_path, 'wb') as f:
            f.write(prepend + original)
        print(f'  ✓ Prepended require() hook to extension.js ({len(prepend)} bytes)')
    else:
        print('  ✓ Hook already prepended to extension.js')
else:
    print(f'  ⚠ Hook script not found at {hook_path} — skipping prepend')
PYEOF

  # ── Binary patches (URL redirects, xqt filter, model listing fix) ──
  python3 << PYEOF
import re

path = '${EXT_JS}'
with open(path, 'rb') as f:
    c = bytearray(f.read())

# ── xqt provider filter patch ──
# Replace the xqt arrow function body to use globalThis.__aurora_providers
# instead of remoteConfiguredProviders from StateManager.
# Original: xqt=(t,e)=>{let r=e?.remoteConfiguredProviders??\$i.get().getRemoteConfigSettings().remoteConfiguredProviders;return!r||!r.length?!0:t&&r.includes(t)}
# New:      xqt=(t,e)=>{let r=globalThis.__aurora_providers||["deepseek","lmstudio","ollama"];return r.includes(t)}
xqt_marker = b'xqt=(t,e)=>{let r=e?.remoteConfiguredProviders??\$i.get()'
xqt_idx = c.find(xqt_marker)
if xqt_idx >= 0:
    # Find opening brace after arrow
    brace_open = c.find(b'{', xqt_idx)
    # Find closing brace (before ;VIf or next statement)
    brace_close = c.find(b'};', brace_open + 1)
    if brace_close < 0:
        brace_close = c.find(b'}', brace_open + 1)
    if brace_open >= 0 and brace_close >= 0:
        original_body = bytes(c[brace_open+1:brace_close])
        # Build replacement: use globalThis var with hardcoded fallback
        providers_list = '${VISIBLE_PROVIDERS}'
        new_body_str = 'let r=globalThis.__aurora_providers||[' + providers_list + '];return r.includes(t)'
        new_body = new_body_str.encode('latin-1')
        if len(new_body) < len(original_body):
            new_body += b';' * (len(original_body) - len(new_body))
        if len(new_body) == len(original_body):
            c[brace_open+1:brace_close] = new_body
            print(f'  ✓ Patched xqt provider filter ({len(original_body)} bytes)')
        else:
            print(f'  ⚠ xqt patch length mismatch: {len(new_body)} vs {len(original_body)}, skipping')
    else:
        print('  ⚠ Could not find xqt body braces, skipping')
else:
    print('  ⚠ xqt function not found, skipping')

# ── api/v0/models fix ──
v1_count = c.count(b'api/v1/models')
v0_count = c.count(b'api/v0/models')
if v1_count > 0 and v0_count == 0:
    c = c.replace(b'api/v1/models', b'api/v0/models')
    print('  ✓ Restored api/v0/models for LM Studio compatibility')
elif v0_count > 0:
    print('  ✓ LM Studio model path already correct (api/v0/models)')
else:
    print('  ⚠ Warning: neither api/v0/models nor api/v1/models found')

# ── DeepSeek URL redirect ──
aurora_url = b'${AURORA_GATEWAY_URL}'
c = c.replace(b'https://api.deepseek.com/v1', aurora_url)
print('  ✓ DeepSeek URL redirected to Aurora gateway')

# ── Default model kVr ──
default_model = b'${DEFAULT_DEEPSEEK_MODEL}'
c = c.replace(b'kVr="claude-sonnet-4-5-20250929"', b'kVr="' + default_model + b'"')
c = c.replace(b'kVr="deepseek-chat"', b'kVr="' + default_model + b'"')
print(f'  ✓ Default model kVr patched to {default_model.decode()}')

with open(path, 'wb') as f:
    f.write(c)
PYEOF

  echo "  ✓ Binary patches applied"

  # ── Move Cline to the secondary (right) side panel ─────────────
  # code-server 4.x (VS Code 1.123) supports secondarySideBar but
  # the viewsContainers manifest key alone may not render the icon.
  # Instead, we write the view container location override directly
  # into the workbench state database so Cline opens on the right.
  GLOBAL_STATE_DB="${HOME}/.local/share/code-server/User/globalStorage/state.vscdb"
  python3 -c "
import json, os, sqlite3

db_path = '${GLOBAL_STATE_DB}'
os.makedirs(os.path.dirname(db_path), exist_ok=True)

conn = sqlite3.connect(db_path)
conn.execute('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB)')

locations = {'claude-dev-ActivityBar': 'secondarySideBar'}
loc_json = json.dumps(locations)

for key in ['viewContainerLocation', 'views.cachedViewContainerLocations']:
    conn.execute('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', (key, loc_json))

# Ensure secondary side bar is not hidden
conn.execute('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', ('auxiliaryBar.hidden', 'false'))

conn.commit()
conn.close()
print('  ✓ Cline moved to secondary (right) side panel')
" 2>&1

  # ── Webview provider dropdown filter ──────────────────────────────
  # The webview UI (ApiOptions.tsx) imports providers.json and renders
  # ALL providers in the dropdown. We must patch the webview bundle to
  # show only our configured providers.
  WEBVIEW_JS="${CLINE_EXT_DIR}/webview-ui/build/assets/index.js"
  if [ -f "$WEBVIEW_JS" ]; then
    python3 << PYEOF
import os

wv_path = '${WEBVIEW_JS}'
with open(wv_path, 'rb') as f:
    wv = bytearray(f.read())

# Find the ven providers array: ven=[{value:"cline",label:"Cline"},...]
ven_marker = b'ven=[{value:"cline"'
ven_start = wv.find(ven_marker)
if ven_start >= 0:
    # Find closing ] of the array followed by ,yen=
    arr_start = ven_start + 4  # skip 'ven='
    yen_marker = b'}],yen='
    yen_idx = wv.find(yen_marker, arr_start + 50)
    if yen_idx >= 0:
        arr_end = yen_idx + 1  # include ']'
        old_arr = bytes(wv[arr_start:arr_end+1])
        
        # Build new array from visible providers
        visible_raw = '${VISIBLE_PROVIDERS}'
        pairs = [p.strip().strip('"') for p in visible_raw.split(',') if p.strip()]
        
        labels = {
            'deepseek': 'DeepSeek',
            'lmstudio': 'LM Studio',
            'ollama': 'Ollama',
        }
        entries = []
        for p in pairs:
            label = labels.get(p, p.title())
            entries.append('{value:"' + p + '",label:"' + label + '"}')
        
        new_arr_str = '[' + ','.join(entries) + ']'
        new_arr = new_arr_str.encode('latin-1')
        
        if len(new_arr) <= len(old_arr):
            new_arr += b' ' * (len(old_arr) - len(new_arr))
            wv[arr_start:arr_end+1] = new_arr
            print(f'  ✓ Webview provider dropdown filtered ({len(entries)} providers, {len(old_arr)} bytes)')
        else:
            print(f'  ⚠ Webview new array too long: {len(new_arr)} > {len(old_arr)}, skipping')
    else:
        print('  ⚠ Webview providers array end not found, skipping')
else:
    print('  ⚠ Webview providers array start not found, skipping')

with open(wv_path, 'wb') as f:
    f.write(wv)
PYEOF
  else
    echo "  ⚠ Webview index.js not found at $WEBVIEW_JS — skipping webview patch"
  fi
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
