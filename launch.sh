#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/aurora-front-end"

# ── Color helpers ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

echo "═══════════════════════════════════════════════════════════════════"
echo "  Aurora Launch Script"
echo "═══════════════════════════════════════════════════════════════════"

# ── Step 1: Load env ───────────────────────────────────────────────
if [ -f "$FRONTEND_DIR/.env" ]; then
  set -a
  source "$FRONTEND_DIR/.env"
  set +a
  info "Loaded $FRONTEND_DIR/.env"
else
  warn "No .env found in $FRONTEND_DIR — using defaults"
fi

# ── Step 2: Kill stale Next.js dev servers ─────────────────────────
info "Cleaning up stale dev servers on ports 3000-3005..."
for PORT in {3000..3005}; do
  PID=$(lsof -ti :$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill -9 "$PID" 2>/dev/null || true
    warn "Killed process on port $PORT (PID $PID)"
  fi
done

# ── Step 3: Start Docker services ──────────────────────────────────
info "Starting Docker services (code-server + onlyoffice)..."
cd "$FRONTEND_DIR"
docker compose up -d --remove-orphans
info "Docker services started"

# Wait for orchestartor to be ready
info "Waiting for orchestrator API on port ${CODE_SERVER_API_PORT:-3001}..."
for i in {1..30}; do
  if curl -s "http://127.0.0.1:${CODE_SERVER_API_PORT:-3001}/api/status" > /dev/null 2>&1; then
    info "Orchestrator API is ready"
    break
  fi
  sleep 1
done

# ── Step 4: Start Next.js dev server ───────────────────────────────
info "Starting Next.js dev server..."
cd "$FRONTEND_DIR/apps/web"
npx next dev &
NEXT_PID=$!
info "Next.js dev server running (PID $NEXT_PID)"

# Wait for Next.js to be ready
for i in {1..30}; do
  if curl -s "http://localhost:3000" > /dev/null 2>&1; then
    info "Next.js ready at http://localhost:3000"
    break
  fi
  # Check alternate ports if 3000 is busy
  if curl -s "http://localhost:3001" > /dev/null 2>&1; then
    info "Next.js ready at http://localhost:3001"
    break
  fi
  if curl -s "http://localhost:3002" > /dev/null 2>&1; then
    info "Next.js ready at http://localhost:3002"
    break
  fi
  sleep 1
done

echo ""
echo "═══════════════════════════════════════════════════════════════════"
info "Aurora stack is up!"
echo "   Frontend:    http://localhost:3000 (or 3001/3002)"
echo "   Orchestrator: http://127.0.0.1:${CODE_SERVER_API_PORT:-3001}"
echo "   OnlyOffice:  http://localhost"
echo ""
info "Next.js PID: $NEXT_PID"
echo "   To stop: kill $NEXT_PID && docker compose down"
echo "═══════════════════════════════════════════════════════════════════"

# Trap to clean up on Ctrl+C
cleanup() {
  echo ""
  info "Shutting down..."
  kill "$NEXT_PID" 2>/dev/null || true
  cd "$FRONTEND_DIR" && docker compose down 2>/dev/null || true
  info "All services stopped."
}
trap cleanup EXIT INT TERM

# Keep running until Ctrl+C
wait "$NEXT_PID"
