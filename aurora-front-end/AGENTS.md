<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->



# Aurora Gateway - Technical Architecture & API Documentation

**Aurora** is a scalable multi-model LLM API gateway built with Next.js 15, designed to provide OpenAI-compatible `/v1/chat/completions` endpoints while supporting multiple underlying model providers (OpenAI, Anthropic, Ollama, LM Studio). The application features a beautiful dark-mode-first UI following minimalist design principles.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [API Documentation](#api-documentation)
4. [Database Schema](#database-schema)
5. [UI/UX Design System](#uiux-design-system)
6. [Authentication & Security](#authentication--security)
7. [Configuration Guide](#configuration-guide)

---

## Architecture Overview

### Turborepo Monorepo Structure

```
root/
├── apps/
│   └── web/              # Next.js frontend application
├── packages/
│   ├── api-gateway/      # LLM routing & response standardization
│   ├── auth-service/     # Authentication, sessions, API key management
│   ├── user-data/        # Database access layer (PostgreSQL)
│   └── shared/           # Common types, utilities, configs
├── agents.md             # This documentation file
└── package.json          # Root workspace config
```

### Data Flow

```
User Request → Auth Check → Model Router → Provider Adapter → LLM Response
                                      ↓
                            User Data Layer (PostgreSQL)
```

**API Key Flow (Updated Architecture):**
Since this is a Next.js App Router application, API routes run server-side and cannot access browser `localStorage`. Instead:

1. **Frontend** stores API keys in browser `localStorage` (set via Settings page or env vars)
2. **Frontend** sends API keys as custom HTTP headers (`x-openai-key`, `x-anthropic-key`, `x-ollama-base`, `x-lmstudio-url`) with each `/api/v1/chat/completions` and `/api/providers/models` request
3. **Server API routes** extract keys from request headers FIRST, then fall back to environment variables (for production deployments)
4. **Ollama** is always attempted as a fallback provider (no API key needed for localhost)

```
Browser localStorage  ──→  Custom Headers (x-openai-key, etc.)  ──→  Server API Route
                                                                         │
Environment Variables (.env) ────────────────────────────────────────────┘
```

1. **Auth Service**: Validates JWT tokens, manages sessions, handles API key creation/cycling
2. **API Gateway**: Routes requests to appropriate provider based on model name and available keys, normalizes responses to OpenAI v1 format
3. **User Data**: Stores chats, usage metrics, prompt templates (Prisma + PostgreSQL)
4. **Shared**: Type definitions for OpenAI-compatible responses

---

## Project Structure

### Frontend (`apps/web/`)

```
apps/web/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login/route.js       # User authentication
│   │   │   ├── register/route.js    # New user registration
│   │   │   ├── me/route.js          # Get current user
│   │   │   └── keys/route.js        # API key management
│   │   ├── v1/
│   │   │   └── chat/completions/route.js    # Main chat proxy endpoint
│   │   └── providers/
│   │       └── models/route.js      # Fetch available models from all providers│   │   └── web-search/
│   │       └── route.js             # DuckDuckGo web search proxy│   ├── settings/page.js             # Settings with API key config
│   ├── page.js                      # Main chat interface
│   └── layout.js                    # App layout
├── globals.css
├── tailwind.config.js
└── package.json
```

### Backend Routes (in `apps/web/app/api/`)

All backend routes use Next.js App Router with Route Handlers. Each route exports functions in OpenAI's API handler style:

- `GET` /api/auth/login - User login
- `POST` /api/auth/register - Register new user  
- `POST` /api/auth/me - Get current user
- `GET` /api/auth/keys - List API keys
- `PUT` /api/auth/keys - Rotate API key
- `POST` /api/v1/chat/completions - Chat completion (OpenAI-compatible)
- `GET` /api/providers/models - Get available models from all providers
- `GET` /api/web-search - DuckDuckGo web search proxy

---

## API Documentation

### Base URL
`http://localhost:3000/api` for auth endpoints, `/v1` for chat completions.

---

### Authentication Endpoints

#### POST `/api/auth/login` - User Login

**Request:**
```json
{
  "email": "user@example.com",
  "password": "your-password"
}
```

**Response:** `200 OK`
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "24h",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### POST `/api/auth/register` - Register New User

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:** `201 Created`
```json
{
  "message": "Registration successful",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### GET `/api/auth/me` - Get Current User

**Headers:** No auth required (public endpoint for demo)

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": null,
  "role": "user"
}
```

---

### API Key Management Endpoints

#### GET `/api/auth/keys` - List API Keys

**Response:** `200 OK`
```json
{
  "keys": [
    {
      "id": "key_xxx_yyy",
      "provider": "OPENAI",
      "name": "My OpenAI Key",
      "createdAt": "2024-01-01T00:00:00Z",
      "isPrimary": true
    }
  ],
  "totalCount": 1
}
```

#### POST `/api/auth/keys` - Create API Key

**Request:**
```json
{
  "provider": "openai",
  "name": "My OpenAI Key"
}
```

**Response:** `201 Created`
```json
{
  "id": "key_xxx_yyy",
  "rawKey": "sk_live_abc123...",
  "provider": "OPENAI",
  "createdAt": "2024-01-01T00:00:00Z",
  "isPrimary": true,
  "name": "My OpenAI Key"
}
```

---

### Chat Completions Endpoint (OpenAI Compatible)

#### POST `/api/v1/chat/completions` - Chat Completion

**Headers:**
- `Content-Type: application/json` (required)
- `x-openai-key: sk-...` (optional — OpenAI API key from localStorage)
- `x-anthropic-key: sk-ant-...` (optional — Anthropic API key from localStorage)
- `x-ollama-base: http://localhost:11434` (optional — Ollama base URL)
- `x-lmstudio-url: http://192.168.0.13:1234/v1` (optional — LM Studio URL)

**Provider Selection Priority:**
1. Request `provider` field (if specified in JSON body)
2. Model name matching (`gpt-*` → OpenAI, `claude-*` → Anthropic)
3. First provider with a valid API key
4. Ollama (always tried as fallback — no auth required for localhost)

**Request:**
```json
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "temperature": 0.7,
  "top_p": 1,
  "max_tokens": null,
  "stream": false
}
```

**Response:** `200 OK` (same structure as OpenAI)
```json
{
  "id": "chat-xxx_yyy",
  "object": "chat.completion",
  "created": 1704067200,
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'm doing well, thank you for asking!"
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 9,
    "total_tokens": 21
  },
  "system_fingerprint": "fp_default"
}
```

**Streaming Response:** Set `"stream": true` for SSE format.

---

### Models Endpoint

#### GET `/api/providers/models` - Get Available Models from Configured Providers

**Response:** `200 OK` (returns models ONLY from providers with configured API keys)

```json
{
  "providerId": "openai",
  "models": [
    {
      "id": "gpt-3.5-turbo",
      "name": "GPT-3.5 Turbo",
      "owned_by": "openai",
      "source": "OpenAI"
    },
    {
      "id": "llama3",
      "name": "Llama 3", 
      "owned_by": "ollama",
      "source": "Ollama"
    }
  ]
}
```

**Note:** Only models from providers with configured API keys will be returned. If no API keys are configured, an empty array `[]` is returned.

---

## Supported Providers

| Provider | Endpoint Format | System Prompt | Token Usage Format |
|----------|-----------------|---------------|-------------------|
| OpenAI | `/chat/completions` | `You are a helpful assistant.` | Standard (`prompt_tokens`, `completion_tokens`) |
| Anthropic | `/messages` | `You are a helpful assistant.` | Converted to standard format |
| Ollama | `/chat` or `/v1/chat` | Model-specific | Estimate prompt tokens from total |
| LM Studio | `/v1/chat/completions` | Model-specific | Standard (if supported) |

---

## Configuration Guide

### Starting the Application (First Time)

1. **Install Dependencies:**
```bash
npm install
cd apps/web && npm run dev
```

2. **Access Settings to Configure API Keys:**
   - Visit `http://localhost:3000/settings`
   - Enter your API keys for each provider (OpenAI, Anthropic, Ollama)
   - Click "Save Provider Settings"
   
3. **Start Chatting:**
   - Go back to the main page (`http://localhost:3000`)
   - Models will automatically load from your configured APIs
   - Start chatting with your preferred models

### Environment Variables (Alternative Configuration)

For production deployments, use environment variables instead of localStorage:

```bash
# Create .env file in project root
OPENAI_API_KEY="sk-your-openai-api-key"
ANTHROPIC_API_KEY="your-anthropic-api-key"
OLLAMA_API_BASE="http://localhost:11434"
LM_STUDIO_HOST="localhost"
LM_STUDIO_PORT="1234"
DEFAULT_PROVIDER="openai"
JWT_SECRET="your-jwt-secret-key-here-minimum-32-chars"
```

Or use environment variable names with "api_" prefix for immediate usage:
```bash
api_openai_key="sk-your-openai-api-key"
api_anthropic_key="your-anthropic-api-key"
```

**Note:** The application automatically fetches models from your configured providers and only displays models that are available through those APIs.

---

## UI/UX Design System

### Color Palette

| Role | Value | Usage |
|------|-------|-------|
| Background Primary | `#0a0a0a` (zinc-950) | Main app background |
| Background Secondary | `#18181b` (zinc-900) | Cards, sidebars, inputs |
| Text Primary | `#fafafa` (zinc-100) | Primary text content |
| Text Secondary | `#a1a1aa` (zinc-500) | Meta info, timestamps |
| Accent | `#6366f1` (indigo-600) | Primary actions, links |

### Component Specifications

#### Message Bubbles

**User Message:**
```css
className="bg-zinc-100 text-zinc-900 rounded-2xl rounded-tr-sm max-w-[85%] px-4 py-3"
```

**Assistant Message:**
```css
className="bg-zinc-800/60 text-zinc-100 rounded-2xl rounded-tl-sm border border-zinc-700/40 max-w-[85%] px-4 py-3"
```

#### Input Area

```css
className="relative bg-zinc-800/60 border border-zinc-700/40 rounded-2xl shadow-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-600/30 transition-all flex flex-col"
```

### Layout Architecture

**Desktop View:**
- Split pane with fixed sidebar (`width-[260px]`) on the left
- Main chat area takes remaining width
- Fixed header at top with model selector

**Mobile View:**
- Collapsible hamburger menu for history/settings
- Single-column layout
- Bottom-fixed input area

### Typography

| Element | Font Family | Size | Line Height |
|---------|-------------|------|-------------|
| Sans text | Geist Sans / Inter / SF | 16px-18px | 1.75 |
| Code/Mono | JetBrains Mono / Fira Code | 14px-16px | 1.6 |

---

## Authentication & Security

### JWT Token Structure

```json
{
  "sub": "user@example.com",    // Subject (email)
  "email": "user@example.com",  // Email address
  "userId": "uuid",              // User ID
  "roles": ["user"]             // Role list
}
```

**Expiration:** 24 hours by default

### API Key Storage

API keys are stored in `localStorage` for immediate use, with optional database persistence:

- Client-side storage: Encrypted localStorage (key derivation)
- Server-side: PostgreSQL table with bcrypt hashing
- Rotation: Support for automatic key rotation via `/api/auth/keys` endpoint

---

## Configuration Guide

### Environment Variables

Create `.env` file in project root:

```bash
# Database (PostgreSQL)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/aurora_gateway"
DATABASE_HOST="localhost"
DATABASE_PORT="5432"
DATABASE_NAME="aurora_gateway"
DATABASE_USER="postgres"
DATABASE_PASSWORD="postgres"

# Authentication
JWT_SECRET="your-jwt-secret-key-here-minimum-32-chars"

# API Gateway - Provider configs (use env vars to set actual keys)
OPENAI_API_KEY="sk-your-openai-api-key"
ANTHROPIC_API_KEY="your-anthropic-api-key"
OLLAMA_API_BASE="http://localhost:11434"
OLLAMA_API_KEY=""  # Ollama doesn't require API key for local models

# Server
PORT="3000"
NODE_ENV="development"

# Optional fallback provider (if primary fails)
DEFAULT_PROVIDER="openai"
```

### Alternative: Use localStorage (No Environment Variables)

You can store API keys in the browser's localStorage:

1. Go to Settings page
2. Enter API keys for each provider
3. Click "Save Provider Settings"

The application will automatically use these keys from localStorage when making requests.

---

### Starting the Application

```bash
# From project root:
npm install

# Start development server (all apps):
cd packages/api-gateway && npm run dev
cd apps/web && npm run dev

# Or use Turborepo for parallel builds:
npx turbo run dev --no-cache
```

---

## Error Handling & Fallback Strategy

The gateway implements graceful fallback:

1. Primary provider fails → retry with exponential backoff
2. If primary is down → try secondary configured provider  
3. Log all errors for debugging
4. Return standard OpenAI error format on failure

Common retryable errors:
- `timeout` - Request timed out
- `rate_limit` / `429` - Rate limit exceeded
- `service_unavailable` / `503` - Service temporarily unavailable
- `unavailable` - Provider service down

---

## Usage Analytics

Token usage is tracked and exposed via:

```json
{
  "usage": {
    "prompt_tokens": 128,
    "completion_tokens": 64,
    "total_tokens": 192
  }
}
```

This data is stored per chat in the database for analytics.

---

## API Provider Support

### OpenAI Format Compatibility

All responses are normalized to OpenAI's v1 format:

- Same response structure
- Standardized `usage` object
- Consistent error handling
- Streaming support via SSE

### Streaming Responses

To stream chat completions, set `"stream": true` in the request. The response will be Server-Sent Events (SSE) format:

```json
data: {"id":"chat-123","choices":[{"delta":{"content":"Hello"},"index":0}]}
```

---

## File Upload & Vision Support (Coming Soon)

The input area supports file uploads via a hidden file input triggered by an attachment button. This enables:

- Image analysis with vision models
- Document processing
- Code snippet uploads
- Context-aware responses

File types supported: `.png`, `.jpg`, `.jpeg`, `.pdf`, `.txt`, `.md`

---

## Web Search

### Overview

The app supports a ChatGPT-style web search feature that fetches current web results and injects them into the model's system prompt. This allows models to answer questions about current events and recent information.

### Architecture

```
User enables Search → Sends message → Web search fetch → System prompt injection → LLM call
                                    ↓
                        /api/web-search?q=query
                                    ↓
                        DuckDuckGo Instant Answer API
```

### Backend Endpoint

#### GET `/api/web-search` - Search the Web

**Query Parameters:**
- `q` (required) — Search query string (max 500 chars)

**Response:** `200 OK`
```json
{
  "query": "Next.js 15 features",
  "abstract": {
    "text": "Next.js 15 introduces...",
    "url": "https://nextjs.org/blog/next-15",
    "source": "DuckDuckGo"
  },
  "results": [
    {
      "title": "Next.js 15 Released",
      "snippet": "Next.js 15 brings major improvements including...",
      "url": "https://example.com/nextjs-15"
    }
  ],
  "timestamp": "2026-06-04T18:00:00.000Z"
}
```

**Implementation Details:**
- Uses DuckDuckGo Instant Answer API (free, no API key)
- 5-second timeout per request
- Returns up to 10 results from `RelatedTopics`
- Falls back to abstract text when no related topics exist
- Non-blocking: message is sent even if search fails

### Frontend Integration

**State:**
- `webSearchEnabled` (boolean) — Tracks whether web search is active
- Toggle persists until manually disabled by user

**UI Elements:**
1. **+ Menu Toggle:** "Search Web" item in the plus menu with live indicator dot when enabled
2. **Indicator Pill:** Appears above the input bar showing "Search" with an X button to disable
3. **Injection:** On send, search results are formatted and prepended to the system prompt

**Injection Format (injected into system message):**
```
[Web Search Results for "user query"]
Abstract: ... (from DuckDuckGo)
Source: ...

Results:
1. Title
   Snippet
   URL
2. ...

Please use these current web results to inform your response. Cite sources with URLs when you reference them.
```

### Plus Menu Click-Away Fix

The plus menu uses a `useEffect` + `mousedown` document listener pattern instead of a fixed-position backdrop. This avoids CSS `transform` stacking context issues that previously broke the click-away behavior. The `plusMenuRef` is attached to the relative wrapper div, and clicking outside the ref's DOM tree closes the menu.

---

## Web Search Loading Indicator

When web search is enabled and a message is being sent, a "Searching the web..." indicator appears inside the loading bubble alongside the bouncing dots animation. This provides visual feedback that the model is fetching and processing web search results.

**Implementation:**
- The loading bubble (shown while `isLoading` is true) includes a conditional section that renders "🔍 Searching the web..." when `webSearchEnabled` is true
- The text uses `text-indigo-300` styling to match the search feature's color theme
- Disappears automatically when the response arrives

## Thinking / Reasoning Display

Models capable of reasoning (such as DeepSeek-v4, OpenAI o-series, and Anthropic's extended thinking) return internal chain-of-thought along with their response. Aurora displays this reasoning in a collapsible section within the assistant's chat bubble, similar to VS Code Copilot Chat.

**Implementation:**
- The `sendMessage` function captures three possible thinking/reasoning fields from the API response: `thinking`, `reasoning_content`, and `reasoning`
- Reasoning text is stored per-message as `msg.thinking` (replacing the old unused global `thoughtProcess` array)
- Each assistant bubble with reasoning shows a clickable **"Thinking"** toggle with a chevron
- Clicking expands/collapses the reasoning text in a styled panel with a left border accent (`border-l-2 border-zinc-600/50`), indigo-tinted text (`text-zinc-400`), and smaller font size (`text-xs`)
- A `Set`-based `expandedThinkingIds` state tracks which messages have their thinking expanded

**Supported Providers:**
| Provider | Thinking Field | Notes |
|----------|---------------|-------|
| DeepSeek | `reasoning_content` | v4/reasoner models provide chain-of-thought |
| Anthropic | `thinking` | Available with extended thinking enabled |
| Ollama | `thinking` | Model-dependent support |

---

## Known Limitations

1. **Code Syntax Highlighting**: Currently using `whitespace-pre-wrap` rendering; production should integrate `react-syntax-highlighter` or similar.

2. **Markdown Rendering**: Basic markdown is supported; for rich formatting, consider integrating `react-markdown` with remark plugins.

3. **Thinking Process**: Reasoning/thinking display is working for DeepSeek (`reasoning_content`) and Anthropic (`thinking`) providers. Ollama thinking support is model-dependent. OpenAI o-series reasoning support requires additional normalization in the API gateway.

4. **Web Search Scope**: DuckDuckGo Instant Answer API is a knowledge graph, not a full web search engine. It may return empty results for many queries. Future improvements could use SerpAPI, Brave Search, or Google Custom Search for broader coverage.

--