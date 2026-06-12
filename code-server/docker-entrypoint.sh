#!/usr/bin/env bash
# docker-entrypoint.sh — Dual-mode entrypoint for the Aurora code-server container
# Mode 1 (default): "server" — Start code-server with Cline preconfigured
# Mode 2: "orchestrator" — Run headless autonomous build loop
set -euo pipefail

MODE="${1:-server}"

case "$MODE" in
  server)
    echo "🚀 Starting code-server (interactive mode, auth=none)..."
    # Export Aurora gateway config so entrypoint scripts can inject Copilot Chat settings
    export AURORA_GATEWAY_URL="${AURORA_GATEWAY_URL:-http://172.19.0.1:3000/api/v1}"
    export AURORA_AUTH_TOKEN="${AURORA_AUTH_TOKEN:-}"
    export COPILOT_DEFAULT_MODEL="${COPILOT_DEFAULT_MODEL:-auto}"
    exec /opt/aurora/scripts/entrypoint.sh \
      --auth none \
      --user-data-dir "${CODE_SERVER_DATA_DIR}" \
      --bind-addr "0.0.0.0:${CODE_SERVER_PORT:-8080}"
    ;;

  orchestrator|headless)
    echo "🤖 Starting autonomous orchestrator — Cline CLI (headless mode)..."
    if [[ -z "${TASK:-}" ]]; then
      echo "ERROR: TASK environment variable is required for orchestrator mode."
      echo "Usage: docker run -e TASK='Build a React todo app' ... aurora-code-server orchestrator"
      exit 1
    fi

    # Ensure node is on PATH (code-server bundles its own)
    export PATH="/usr/lib/code-server/lib:${PATH}"

    # Use openai-compatible provider with custom base URL for LM Studio
    CLINE_PROVIDER="${CLINE_PROVIDER:-openai-compatible}"
    LMSTUDIO_URL="${LMSTUDIO_URL:-http://localhost:1234/v1}"
    LMSTUDIO_MODEL="${LMSTUDIO_MODEL:-qwen-coder}"
    LMSTUDIO_API_KEY="${LMSTUDIO_API_KEY-lm-studio}"

    echo "  Configuring Cline CLI provider via cline auth..."
    cline auth \
      --provider "$CLINE_PROVIDER" \
      --apikey "${LMSTUDIO_API_KEY:-sk-lm-studio}" \
      --baseurl "${LMSTUDIO_URL%/}" \
      --modelid "$LMSTUDIO_MODEL" \
      2>&1 || echo "  ⚠ cline auth had issues (continuing anyway)"

    # Run the task runner (iterative loop that calls cline --auto-approve)
    exec node /opt/aurora/orchestrator/task-runner.js \
      --task "$TASK" \
      --workspace "${WORKSPACE_DIR:-/workspace}"
    ;;

  api)
    echo "🔌 Starting Orchestrator API server (headless)..."

    # Ensure node is on PATH (code-server bundles its own)
    export PATH="/usr/lib/code-server/lib:${PATH}"

    # Use openai-compatible provider with custom base URL for LM Studio
    CLINE_PROVIDER="${CLINE_PROVIDER:-openai-compatible}"
    LMSTUDIO_URL="${LMSTUDIO_URL:-http://localhost:1234/v1}"
    LMSTUDIO_MODEL="${LMSTUDIO_MODEL:-qwen-coder}"
    LMSTUDIO_API_KEY="${LMSTUDIO_API_KEY:-sk-lm-studio}"

    echo "  Configuring Cline CLI provider via cline auth..."
    cline auth \
      --provider "$CLINE_PROVIDER" \
      --apikey "${LMSTUDIO_API_KEY}" \
      --baseurl "${LMSTUDIO_URL%/}" \
      --modelid "$LMSTUDIO_MODEL" \
      2>&1 || echo "  ⚠ cline auth had issues (continuing anyway)"

    # Dependencies pre-installed during Docker build
    mkdir -p /workspaces /tmp/jobs
    exec node /opt/aurora/orchestrator/api-server.js
    ;;
  both)
    echo "🚀 Starting code-server (interactive) + Orchestrator API (headless)..."
    export PATH="/usr/lib/code-server/lib:${PATH}"

    # Configure Cline CLI for orchestrator
    CLINE_PROVIDER="${CLINE_PROVIDER:-openai-compatible}"
    LMSTUDIO_URL="${LMSTUDIO_URL:-http://localhost:1234/v1}"
    LMSTUDIO_MODEL="${LMSTUDIO_MODEL:-qwen-coder}"
    LMSTUDIO_API_KEY="${LMSTUDIO_API_KEY:-sk-lm-studio}"

    echo "  Configuring Cline CLI provider via cline auth..."
    cline auth \
      --provider "$CLINE_PROVIDER" \
      --apikey "${LMSTUDIO_API_KEY}" \
      --baseurl "${LMSTUDIO_URL%/}" \
      --modelid "$LMSTUDIO_MODEL" \
      2>&1 || echo "  ⚠ cline auth had issues (continuing anyway)"

    # Start orchestrator API in background
    mkdir -p /workspaces /tmp/jobs
    node /opt/aurora/orchestrator/api-server.js &
    API_PID=$!
    echo "  Orchestrator API started (PID $API_PID)"

    # Start code-server in foreground (auth=none for iframe auto-login)
    exec /opt/aurora/scripts/entrypoint.sh \
      --auth none \
      --user-data-dir "${CODE_SERVER_DATA_DIR}" \
      --bind-addr "0.0.0.0:${CODE_SERVER_PORT:-8080}"
    ;;

  *)
    echo "Usage: docker run ... aurora-code-server [server|orchestrator|api|both]"
    echo "  server        — Start interactive code-server with Cline"
    echo "  orchestrator  — Run autonomous headless build loop"
    echo "  api           — Start Orchestrator REST API server"
    echo "  both          — Interactive code-server + Orchestrator API"
    exit 1
    ;;
esac
