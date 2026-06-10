# ── Dockerfile — Autonomous App Builder (code-server + Cline + LM Studio) ──
# Multi-stage build that bundles code-server with Cline pre-configured for LM Studio.
#
# Build:
#   docker build -t aurora-code-server .
#
# Run (standalone, LM Studio on host):
#   docker run -p 8080:8080 \
#     -e LMSTUDIO_URL=http://host.docker.internal:1234/v1 \
#     -e LMSTUDIO_MODEL=qwen-coder \
#     -v $(pwd)/workspace:/workspace \
#     aurora-code-server
#
# Run (with orchestrator headless):
#   docker run --rm \
#     -e TASK="Build a React todo app" \
#     -e LMSTUDIO_URL=http://host.docker.internal:1234/v1 \
#     -v $(pwd)/workspace:/workspace \
#     aurora-code-server orchestrator

# ── Stage 1: Build code-server from source ──────────────────────────────
FROM node:22-bookworm AS builder

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libkrb5-dev \
    libsecret-1-dev \
    libx11-dev \
    libxkbfile-dev \
    quilt \
    git \
    jq \
  && rm -rf /var/lib/apt/lists/*

# Clone the forked code-server
ARG CODE_SERVER_REPO=https://github.com/coder/code-server.git
ARG CODE_SERVER_REF=main

WORKDIR /src
RUN git clone --depth 1 --branch "$CODE_SERVER_REF" "$CODE_SERVER_REPO" . && \
    git submodule update --init --depth 1

# Apply patches & build
COPY scripts/ /tmp/aurora-scripts/
RUN if [ -f /tmp/aurora-scripts/build-patch.sh ]; then \
      bash /tmp/aurora-scripts/build-patch.sh; \
    fi

RUN npm ci && npm run build

# ── Stage 2: Production runtime ─────────────────────────────────────────
FROM node:22-bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    openssh-client \
    jq \
    procps \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash coder
USER coder
WORKDIR /home/coder

# Copy built code-server
COPY --from=builder --chown=coder:coder /src/release-standalone /opt/code-server

# Copy Aurora orchestration scripts
COPY --chown=coder:coder scripts/ /opt/aurora/scripts/
COPY --chown=coder:coder orchestrator/ /opt/aurora/orchestrator/

# Set up PATH
ENV PATH="/opt/code-server/bin:/opt/aurora/scripts:${PATH}" \
    CODE_SERVER_DATA_DIR="/home/coder/.local/share/code-server" \
    LMSTUDIO_URL="http://localhost:1234/v1" \
    LMSTUDIO_MODEL="qwen-coder" \
    CLINE_YOLO_MODE="true" \
    WORKSPACE_DIR="/workspace"

# Create workspace mount point
RUN mkdir -p /workspace && chown coder:coder /workspace

# Expose code-server port + orchestrator API
EXPOSE 8080 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/healthz || exit 1

# ── Entrypoints ─────────────────────────────────────────────────────────
# Default: Start code-server with Cline preconfigured
# Override by setting first arg to "orchestrator" for headless mode

COPY --chown=coder:coder docker-entrypoint.sh /docker-entrypoint.sh

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/docker-entrypoint.sh"]
CMD ["server"]
