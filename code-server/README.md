# Aurora Code-Server — Autonomous App Builder

**Fork of [coder/code-server](https://github.com/coder/code-server) bundled with [Cline](https://github.com/cline/cline) pre-configured for [LM Studio](https://lmstudio.ai), plus a lightweight orchestration layer for fully autonomous task execution.**

> Accept a task → iterate in a loop → stop on your signal.

---

## Architecture

### Two Paths, One Container — Both Use Real Cline

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Container                          │
│                                                              │
│  INTERACTIVE MODE                    HEADLESS MODE           │
│  ┌──────────────────┐               ┌──────────────────┐    │
│  │   code-server     │               │   Orchestrator    │    │
│  │   (VS Code web)   │               │  (task-runner.js) │    │
│  │        │          │               │        │          │    │
│  │   ┌────▼─────┐    │               │   ┌────▼─────┐    │    │
│  │   │  Cline    │    │               │   │  Cline    │    │    │
│  │   │ (VS Code  │    │               │   │ (CLI)     │    │    │
│  │   │ extension)│    │               │   │ npm pkg   │    │    │
│  │   └────┬─────┘    │               │   └────┬─────┘    │    │
│  │        │          │               │        │          │    │
│  └────────┼──────────┘               └────────┼──────────┘    │
│           │                                   │               │
│           └───────────────┬───────────────────┘               │
│                           │                                   │
│                 OpenAI-compatible API                          │
│                 /v1/chat/completions                           │
│                           │                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │
                  ┌─────────┴─────────┐
                  │    LM Studio      │
                  │  (QWEN / local)   │
                  │  localhost:1234   │
                  └───────────────────┘
```

### Two Modes

| Mode | Command | Agent | How it works |
|------|---------|-------|--------------|
| **Interactive** | `docker compose up` | **Cline** (VS Code extension) | Open `localhost:8080` → Cline in sidebar → type task → agent runs with full VS Code tooling |
| **Headless** | `docker compose run orchestrator` | **Cline** (CLI) | `cline --auto-approve true --provider openai-compatible` — same Cline agent, CLI mode |

**Both paths use the real Cline.** Interactive mode uses the VS Code extension (installed via `code-server --install-extension`). Headless mode uses the Cline CLI (`npm i -g cline` → `cline --auto-approve true "task"`). Both connect to LM Studio via the openai-compatible provider.

---

## Quick Start

### Prerequisites

- [LM Studio](https://lmstudio.ai) running locally with a model loaded (e.g., QWEN Coder)
- Docker installed
- (Optional) Node.js 22+ for local development

### 1. Clone & Build

```bash
cd code-server
docker build -f Dockerfile.slim -t aurora-code-server .

# Or use docker compose (reads .env / .env.local automatically):
docker compose build
```

### 2. Configure LM Studio

Create `.env.local` (or copy `.env.example` → `.env`):

```bash
LMSTUDIO_URL=http://192.168.0.13:1234/v1   # Your LM Studio URL
LMSTUDIO_MODEL=qwen-coder                   # Model loaded in LM Studio
LMSTUDIO_API_KEY=sk-lm-studio               # sk- prefix satisfies Cline format
```

### 3. Run Interactive Mode (code-server + Cline in browser)

```bash
docker compose up -d
# Open http://localhost:8080 — Cline is pre-configured in the sidebar
```

Or directly:

```bash
docker run -p 8080:8080 \
  --env-file .env.local \
  -v $(pwd)/workspace:/workspace \
  aurora-code-server server
```

### 4. Run Autonomous Headless Mode

```bash
docker run --rm \
  --env-file .env.local \
  -e TASK="Build a React todo app with SQLite persistence" \
  aurora-code-server orchestrator
```

The orchestrator will:
1. Send the task to Cline (with `--yolo` auto-approve)
2. Cline plans and executes (read/write files, run commands)
3. Output is observed and fed back for the next iteration
4. Stops when: task complete detected, max iterations reached, or stop file touched

### 4. Stop the Orchestrator

```bash
# From another terminal:
touch /tmp/orchestrator-stop

# Or via npm script (if running locally):
npm run stop
```

---

## File Structure

```
code-server/
├── Dockerfile                    # Multi-stage Docker build
├── docker-entrypoint.sh          # Dual-mode entrypoint (server | orchestrator)
├── package.json                  # Orchestrator npm scripts
├── scripts/
│   ├── entrypoint.sh             # Master startup: install → preconfigure → start
│   ├── install-cline.sh          # Downloads & installs Cline VSIX
│   ├── preconfigure-cline.sh     # Injects LM Studio settings into code-server
│   └── build-patch.sh            # Patch for upstream ci/build/build-release.sh
├── orchestrator/
│   └── task-runner.js            # Autonomous build loop (Node.js)
└── README.md                     # This file
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LMSTUDIO_URL` | `http://localhost:1234/v1` | LM Studio OpenAI-compatible API base |
| `LMSTUDIO_MODEL` | `qwen-coder` | Model ID to use |
| `LMSTUDIO_API_KEY` | `sk-lm-studio` | API key (LM Studio doesn't need auth, but `sk-` prefix required by Cline) |
| `CLINE_PROVIDER` | `openai-compatible` | Provider for Cline CLI |
| `CLINE_TIMEOUT` | `600` | Timeout per Cline CLI call in seconds |
| `MAX_ITERATIONS` | `50` | Max loop iterations before forced stop |
| `STOP_FILE` | `/tmp/orchestrator-stop` | Touch this file to stop the orchestrator |
| `TASK` | *(required for orchestrator)* | The build task to execute |
| `WORKSPACE_DIR` | `/workspace` | Directory for generated project files |
| `CODE_SERVER_PORT` | `8080` | Port for the web UI |
| `COOLDOWN_MS` | `2000` | Pause between iterations |
| `ORCHESTRATOR_PLAN_FIRST` | `true` | Run `cline -p` (plan mode) before acting |

### VS Code Settings Injected

The `preconfigure-cline.sh` script writes these settings to `~/.local/share/code-server/User/settings.json`:

```json
{
  "cline.apiProvider": "openai-compatible",
  "cline.openAiCompatibleBaseUrl": "http://localhost:1234/v1",
  "cline.openAiCompatibleModelId": "qwen-coder",
  "cline.autoApprovalEnabled": true,
  "cline.maxTokens": 4096,
  "cline.temperature": 0.0
}
```

---

## Orchestrator How It Works

```
┌──────────┐     ┌──────────────┐     ┌────────────────┐
│  TASK    │────▶│ Build Prompt │────▶│ Spawn Cline CLI │
│  INPUT   │     │ (w/ history) │     │ --auto-approve  │
└──────────┘     └──────────────┘     │   true          │
                                      └───────┬────────┘
                                              │
                                       ┌──────▼──────┐
                                       │  Cline runs  │
                                       │  tool loop   │
                                       │  internally  │
                                       └──────┬──────┘
                                              │
                                ┌─────────────┴─────────────┐
                                │                           │
                          ┌─────▼─────┐             ┌──────▼──────┐
                          │  Done?    │             │  Continue   │
                          │  Stop?    │             │  Next Iter  │
                          └─────┬─────┘             └──────┬──────┘
                                │                          │
                          ┌─────▼─────┐             ┌──────▼──────┐
                          │   STOP    │             │  Build Next │
                          │  Report   │             │   Prompt    │
                          └───────────┘             └─────────────┘
```

Each iteration spawns `cline --auto-approve true --provider openai-compatible -c /workspace "prompt"`.
Cline handles all tool calling (read_file, write_to_file, execute_command, web_fetch, etc.) internally.
The orchestrator captures the output, checks for completion, and feeds context into the next iteration.

1. **Stop file** — `touch /tmp/orchestrator-stop` from any terminal
2. **Max iterations** — Default 50, configurable via `MAX_ITERATIONS`
3. **Completion detected** — Cline outputs "TASK COMPLETE" or similar markers
4. **SIGINT/SIGTERM** — Handled gracefully

### State Persistence

The orchestrator saves state to `/tmp/orchestrator-state.json`:
- Iteration count & history
- Output summaries from each iteration
- Timestamps and exit codes

Check progress: `cat /tmp/orchestrator-state.json | jq .`

---

## Fork Integration Guide

To integrate this into your own code-server fork:

### Step 1: Fork coder/code-server

```bash
git clone https://github.com/YOUR_USERNAME/code-server.git
cd code-server
git submodule update --init
```

### Step 2: Add Aurora Scripts

```bash
cp -r /path/to/Aurora/code-server/scripts/ ./scripts/aurora/
cp /path/to/Aurora/code-server/orchestrator/task-runner.js ./scripts/aurora/
```

### Step 3: Modify ci/build/build-release.sh

Add this line before the final packaging step:

```bash
# Bundle Cline VSIX and orchestration scripts
bash ./scripts/aurora/build-patch.sh
```

### Step 4: Modify Dockerfile or Entrypoint

Replace the default entrypoint with:

```dockerfile
COPY scripts/aurora/entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/entrypoint.sh"]
```

---

## Local Development (Without Docker)

```bash
# Install code-server globally
npm install -g code-server

# Install Cline extension
bash scripts/install-cline.sh

# Preconfigure for LM Studio
bash scripts/preconfigure-cline.sh

# Start code-server
code-server --bind-addr 0.0.0.0:8080
```

Run orchestrator standalone:

```bash
TASK="Build a Python Flask API" \
LMSTUDIO_URL=http://localhost:1234/v1 \
node orchestrator/task-runner.js
```

---

## Key Design Decisions

### Why iteration loop vs single shot?
Single-shot prompts hit context limits quickly. The iteration loop with observation gives the model manageable chunks and lets it recover from errors naturally. Each iteration spawns a fresh Cline CLI process with accumulated context.

### Why `--auto-approve true`?
Cline's auto-approve flag (formerly `--yolo`) auto-approves all tool calls — essential for headless autonomous operation. Without it, the agent would pause waiting for user approval on every file write and command execution.

### Why openai-compatible provider?
LM Studio exposes an OpenAI-compatible API at `/v1`. Cline's `openai-compatible` provider works with this out of the box — no custom adapter needed.

### Why bundle both VS Code extension AND CLI?
- **VS Code extension** → Interactive mode in the browser. Pre-configured settings so Cline is ready in the sidebar immediately.
- **CLI** (`npm i -g cline`) → Headless mode. Spawned programmatically by the orchestrator. Same agent logic, no GUI overhead.
- Both connect to the same LM Studio endpoint via `OPENAI_API_BASE`.

---

## Related

- [coder/code-server](https://github.com/coder/code-server) — VS Code in the browser
- [cline/cline](https://github.com/cline/cline) — Autonomous coding agent
- [LM Studio](https://lmstudio.ai) — Local model runner
- [Aurora Gateway](../) — Main Aurora project (multi-model LLM API gateway)
