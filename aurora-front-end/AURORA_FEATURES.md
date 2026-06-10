# Aurora Self-Improving Agent Features

> **Inspired by Lovable.dev's architecture** — an agent that learns from mistakes and automates reusable patterns.

---

## Overview

Aurora implements two interconnected systems that make the AI coding agent progressively smarter over time:

1. **Self-Improving Problem/Solution Corpus** — Captures agent friction events (build failures, stuck loops, barren streaks, etc.) and re-injects past learnings into the system prompt to prevent repeating mistakes.

2. **Agent-Learned Skills** — The agent automatically extracts reusable coding patterns after successful build sessions and saves them as markdown skill files with keyword matching for future injection.

Both systems operate **autonomously** — no user configuration or management required.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentPanel.jsx                          │
│  ┌──────────────────────┐   ┌────────────────────────────┐  │
│  │  Friction Detection   │   │  Skill Auto-Extraction     │  │
│  │  (during agent loop)  │   │  (after successful build)  │  │
│  └─────────┬────────────┘   └───────────┬────────────────┘  │
│            │ fire-and-forget             │ parseToolCalls    │
│            ▼                             ▼                   │
│  ┌──────────────────────┐   ┌────────────────────────────┐  │
│  │  corpus-utils.js     │   │  skills-utils.js           │  │
│  │  - appendCorpusEntry │   │  - createSkill             │  │
│  │  - loadRecentCorpus  │   │  - loadAllSkills           │  │
│  │  - markResolved      │   │  - skillMatchesRequest     │  │
│  └─────────┬────────────┘   └───────────┬────────────────┘  │
│            │                             │                    │
│            ▼                             ▼                    │
│  ┌────────────────────┐    ┌──────────────────────────────┐ │
│  │ .aurora/corpus.jsonl│    │ .aurora/skills/*.md          │ │
│  └────────────────────┘    └──────────────────────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  System Prompt Injection (buildSystemPrompt)         │   │
│  │  - Matched skills injected based on keyword overlap  │   │
│  │  - Unresolved corpus entries injected as warnings    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Self-Improving Corpus

### How It Works

The corpus is a dual-scoped JSONL file that records friction events:

- **Per-workspace**: `.aurora/corpus.jsonl` in each workspace directory
- **Global**: `~/.aurora/corpus.jsonl` for cross-project learning (max 500 entries, auto-prunes oldest)

### Capture Points

The agent detects these friction event types during the build loop:

| Event Type | Trigger | When |
|-----------|---------|------|
| `no_tool_streak` | Model stops producing tool calls 3x in a row with pending tasks | Mid-loop |
| `build_failure` | `npm install` or `next build` returns errors | Build pipeline |
| `build_resolved` | Build passes after a prior `build_failure` | Post-build |
| `stuck_loop` | Model repeats the same `list_dir` or `read_file` call 3x | Mid-loop |
| `dev_server_polling` | 3 consecutive `dev_server_status` calls return "not running" | Mid-loop |
| `read_only_streak` | 5 consecutive read-only tool calls without any writes | Mid-loop |
| `barren_streak` | 8+ iterations without creating or modifying any files | Mid-loop |
| `tool_error` | Any tool execution returns an error | Per-tool call |

### Data Model

Each entry in the corpus JSONL:

```json
{
  "hash": "sha256_of_type+problem+context",
  "type": "build_failure",
  "problem": "Build failed on attempt 1/3",
  "context": "[next build] FAILED:\nError: Cannot find module...",
  "resolution": "",
  "resolved": false,
  "timestamp": "2025-01-15T12:34:56.789Z",
  "workspaceId": "my-project"
}
```

### Deduplication

- SHA-256 hash computed from `type|problem|context`
- Checked against the last 50 entries in both workspace and global files
- `tool_error` events are also deduplicated per-session (same file+error won't fire twice)

### Injection

Before each agent run, unresolved corpus entries from the last 50 are injected into the system prompt:

```
=== PAST FRICTION EVENTS (avoid repeating) ===
- [stuck_loop] Model stuck repeating: read_file src/index.ts
- [build_failure] Build failed on attempt 1/3
  Resolution: Fixed missing import in src/app/page.tsx

Learn from these past issues. Do NOT repeat the same mistakes.
```

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/workspace/[id]/corpus` | Load recent entries (workspace) |
| `POST` | `/api/workspace/[id]/corpus` | Append new entry (workspace + global) |
| `PATCH` | `/api/workspace/[id]/corpus` | Mark entry as resolved |
| `GET` | `/api/corpus` | View global corpus entries |
| `POST` | `/api/corpus` | Append global-only entry |

---

## 2. Agent-Learned Skills

### How It Works

After a **successful build session** (build passed, 2+ files created, all tasks completed), the agent automatically:

1. Composes an extraction prompt summarizing the original request, affected files, and completed tasks
2. Calls the LLM with instructions to identify reusable patterns
3. Parses any `create_skill` tool block from the LLM response
4. Persists the skill as a `.md` file with YAML frontmatter in `.aurora/skills/`

### Skill File Format

```markdown
---
name: Next.js App Router Setup
description: Create a Next.js App Router project with TypeScript, Tailwind CSS, and proper path aliases
applyTo: next.js, nextjs, app router, typescript, tailwind, setup
created: 2025-01-15T12:34:56.789Z
---

## Steps

1. Create `package.json` with next@latest, react@^19, react-dom@^19, tailwindcss, typescript
2. Create `tsconfig.json` with `baseUrl: "."` and `paths: { "@/*": ["src/*"] }`
3. Create `next.config.mjs` (empty config, export default)
4. Create `tailwind.config.js` pointing to `src/**/*.{ts,tsx}`
5. Create `postcss.config.js` with tailwindcss + autoprefixer
6. Create `src/app/globals.css` with Tailwind directives
7. Create `src/app/layout.tsx` importing `./globals.css`
8. Create `src/app/page.tsx` as the home page
9. Run `npm install --legacy-peer-deps` to install all deps
10. Run `dev_server_start` to verify the build
```

### Keyword Matching

The `applyTo` frontmatter field controls matching:

- Keywords are **case-insensitive substrings** matched against the user's full message
- A skill matches if **any** keyword appears in the user's request
- Skills with **no keywords** are always injected (general-purpose patterns)

**Example:** A skill with `applyTo: next.js, react, tailwind` would match:
- "Build me a Next.js dashboard" ✅
- "Create a React component" ✅
- "Style with Tailwind" ✅
- "Set up a Python server" ❌

### The `create_skill` Tool

Models can explicitly save skills during any build session using:

```
create_skill name="Pattern Name" description="What it does" keywords="kw1, kw2"
Instructions...
```

This tool is available in the model's toolkit and can be called just like `create_file` or `read_file`.

### Auto-Extraction vs Manual

| Method | Trigger | When |
|--------|---------|------|
| **Auto-extraction** | Build passes + 2+ files created + all tasks done | After every successful build |
| **Manual** | Model calls `create_skill` tool | Anytime during agent mode |

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/workspace/[id]/skills` | List all skills (content trimmed to 200 chars) |
| `POST` | `/api/workspace/[id]/skills` | Create a new skill |
| `GET` | `/api/workspace/[id]/skills/[name]` | Get full skill content |
| `DELETE` | `/api/workspace/[id]/skills/[name]` | Delete a skill |

---

## 3. Debug Panel

The AgentPanel includes a collapsible **🧠 Learnings** debug panel at the bottom of the chat view that shows:

- **⚠️ Unresolved Friction Events**: Type-coded dots (red=build_failure, amber=tool_error, orange=stuck_loop, gray=other) with truncated problem descriptions
- **📚 Skills**: List of agent-learned skills with names, descriptions, and keyword tags

The panel shows counts in the collapsed header (`(3 issues, 5 skills)`) for at-a-glance visibility.

---

## 4. Workspace Bootstrapping

When a new workspace is created via `/api/workspace/create`:

1. `.aurora/` directory is created
2. Empty `corpus.jsonl` file is initialized
3. `skills/` directory is created
4. A `skills/README.md` is generated explaining the auto-creation mechanism

This ensures every workspace is ready for self-improving agent features from the start.

---

## File Reference

| File | Purpose |
|------|---------|
| `apps/web/lib/corpus-utils.js` | Corpus storage/retrieval/dedup utilities |
| `apps/web/lib/skills-utils.js` | Skills storage/parsing/matching utilities |
| `apps/web/app/api/workspace/[id]/corpus/route.js` | Per-workspace corpus CRUD |
| `apps/web/app/api/corpus/route.js` | Global cross-project corpus |
| `apps/web/app/api/workspace/[id]/skills/route.js` | Skills list/create |
| `apps/web/app/api/workspace/[id]/skills/[name]/route.js` | Individual skill get/delete |
| `apps/web/app/api/workspace/create/route.js` | Bootstraps `.aurora/` on creation |
| `apps/web/app/components/AgentPanel.jsx` | Friction capture, skill injection, extraction, debug panel |

---

## Design Principles

1. **Fire-and-forget capture**: Corpus POSTs use `fetch()` without `await` — never block the agent loop
2. **Best-effort extraction**: Skill auto-extraction failures are silently ignored — the build still completes
3. **Dedup by content hash**: SHA-256 hashing prevents duplicate corpus entries, even across sessions
4. **Dual-scope storage**: Workspace-specific + global corpus enables cross-project learning
5. **No user management**: Everything is automated — users never need to create, edit, or delete skills manually
6. **Incremental improvement**: Each build session makes the agent smarter for the next one
