# Aurora AI Gateway - Technical Architecture & API Documentation

## Overview

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

### Microservices Pattern (Turborepo Monorepo)

```
root/
├── packages/
│   ├── api-gateway/      # LLM routing & response standardization
│   ├── auth-service/     # Authentication, sessions, API key management
│   ├── user-data/        # Database access layer (Prisma)
│   └── shared/           # Common types, utilities, configs
└── apps/
    └── web/              # Next.js frontend application

```

### Data Flow

```
User Request → Auth Gateway → Model Router → Provider Adapter → LLM Response
                                      ↓
                            User Data Layer (PostgreSQL)
```

1. **Auth Service**: Validates JWT tokens, manages sessions, handles API key creation/cycling
2. **API Gateway**: Routes requests to appropriate provider, normalizes responses
3. **User Data**: Stores chats, usage metrics, prompt templates
4. **Shared**: Type definitions for OpenAI-compatible responses

---

## Project Structure

### Root (`packages/` & `apps/`)

#### API Gateway Package (`packages/api-gateway/`)

```
packages/api-gateway/
├── package.json
└── src/
    ├── index.js                    # Main entry point, Express setup
    ├── routers/
    │   └── chat-completions.js     # /v1/chat/completions handler
    ├── middleware/
    │   └── model-router.js         # Routes to appropriate provider
    └── adapters/
        ├── token-normalizer.js     # Normalizes token usage across providers
        ├── system-prompt-injector.js
        ├── providers.js            # Provider connection configs
        └── index.js
```

**Responsibility**: Proxies LLM requests, handles streaming responses, normalizes output to OpenAI format.

#### Auth Service Package (`packages/auth-service/`)

```
packages/auth-service/
├── package.json
└── src/
    ├── index.js                    # Service initialization
    ├── handlers/
    │   ├── auth-handler.js         # JWT token operations
    │   ├── session-manager.js      # Session persistence
    │   └── api-key-manager.js      # Encrypted API key management
    └── routes/
        └── auth-routes.js          # /api/auth/** endpoints
```

**Responsibility**: Authentication, session management, secure API key handling with encryption.

#### User Data Package (`packages/user-data/`)

```
packages/user-data/
├── package.json
├── prisma/
│   └── schema.prisma               # Database schema definition
└── src/
    ├── index.js                    # Client initialization
    ├── schema/                     # Schema utilities
    │   └── index.js
    └── prisma/
        └── client.js               # Prisma client singleton
```

**Responsibility**: CRUD operations for users, chats, usage analytics via PostgreSQL.

#### Shared Package (`packages/shared/`)

```
packages/shared/
├── package.json
└── src/
    ├── index.js                    # Main exports
    ├── types/
    │   └── index.js                # OpenAI-compatible type shapes
    └── utils/
        └── index.js                # Utility functions (dates, formatting)
```

**Responsibility**: Shared type definitions and utility functions across all services.

---

## API Documentation

### Base URL

`http://localhost:3000/api` (adjust port based on deployment)

---

### Authentication Endpoints

#### POST `/auth/login` - User Login

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:** `200 OK`
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "24h"
}
```

#### POST `/auth/register` - Register New User

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

#### GET `/auth/me` - Get Current User

**Headers:**
- `Authorization: Bearer <token>`

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

#### POST `/auth/keys/create` - Create API Key

**Headers:**
- `Authorization: Bearer <token>`

**Request:**
```json
{
  "provider": "openai",
  "name": "My OpenAI Key",
  "fromModel": null
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

#### POST `/auth/keys/cycle` - Rotate API Key

**Headers:**
- `Authorization: Bearer <token>`

**Request:**
```json
{
  "provider": "openai",
  "force": false
}
```

**Response:** `200 OK`
```json
{
  "id": "key_xxx_yyy",
  "rawKey": "sk_live_new_key...",
  "provider": "OPENAI",
  "lastRotated": "2024-01-01T00:00:00Z",
  "isPrimary": true
}
```

#### GET `/auth/keys` - List API Keys

**Headers:**
- `Authorization: Bearer <token>`

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

---

### Chat Completions Endpoint (OpenAI Compatible)

#### POST `/v1/chat/completions` - Chat Completion

**Headers:**
- `Authorization: Bearer <api_key>` - Use stored API key from auth service

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
  }
}
```

**Streaming Response:** Set `"stream": true` for SSE format:

```
data: {"id":"chat-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"I'm"},"finish_reason":null}]}

data: {"choices":[{"delta":{"content":" doing"},"finish_reason":null}]}

data: {"choices":[{"delta":{"content":" well,"},"finish_reason":null}]}

data: {"choices":[{"delta":{"content":" thank you"},"finish_reason":null}]}

data: {"id":"chat-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

---

## Database Schema

### Tables

#### `users`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Unique user identifier |
| email | VARCHAR(255) | User email (unique) |
| name | VARCHAR(255) | Optional display name |
| profileImage | VARCHAR(255) | Profile image URL |
| createdAt | TIMESTAMP | Account creation time |
| updatedAt | TIMESTAMP | Last update time |

#### `api_keys`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Unique key identifier |
| userId | VARCHAR(255) | FK to users.id |
| provider | ENUM | OPENAI|ANTHROPIC|OLLAMA|LM_STUDIO |
| keyHash | VARCHAR(256) | Encrypted API key |
| isPrimary | BOOLEAN | Whether this is primary key |
| name | VARCHAR(255) | Optional display name |
| lastRotated | TIMESTAMP | Last rotation time |
| rotationCount | INT | Number of rotations |
| revokedAt | TIMESTAMP | Revocation time (nullable) |
| createdAt | TIMESTAMP | Creation time |

#### `chats`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Unique chat identifier |
| userId | VARCHAR(255) | FK to users.id |
| title | VARCHAR(255) | Generated or user-set title |
| modelId | VARCHAR(255) | Model used for this chat |
| provider | VARCHAR(100) | Provider of the response |
| isArchived | BOOLEAN | Archive flag |
| createdAt | TIMESTAMP | Chat creation time |

#### `messages`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Unique message identifier |
| chatId | UUID | FK to chats.id |
| role | ENUM | USER|ASSISTANT|SYSTEM|FUNCTION |
| content | TEXT | Message text content |
| model | VARCHAR(255) | Model that generated response |
| finishReason | ENUM | STOP|LENGTH|FUNCTION_CALL|null |
| provider | VARCHAR(100) | Provider of response |
| tokensUsed | INT | Token count |
| createdAt | TIMESTAMP | Message creation time |

---

## UI/UX Design System

### Color Palette

| Role | Value | Usage |
|------|-------|-------|
| Background Primary | `#0a0a0a` (zinc-950) | Main app background |
| Background Secondary | `#18181b` (zinc-900) | Cards, sidebars, inputs |
| Text Primary | `#fafafa` (zinc-100) | Primary text content |
| Text Secondary | `#a1a1aa` (zinc-500) | Meta info, timestamps |
| Accent | `#6366f1` (indigo-500) | Primary actions, links |
| Code Block BG | `#242427` | Syntax highlighting container |

### Typography

| Element | Font Family | Size | Line Height |
|---------|-------------|------|-------------|
| Sans text | Geist Sans / Inter / SF | 16px-18px | 1.75 |
| Code/Mono | JetBrains Mono / Fira Code | 14px-16px | 1.6 |
| Headings | Geist Sans Bold | 20px+ | 1.3 |

### Component Specifications

#### Message Bubbles

**User Message:**
```
className="bg-zinc-100 text-zinc-900 rounded-2xl rounded-tr-sm max-w-[85%] px-4 py-3"
```

**Assistant Message:**
```
className="bg-zinc-900/50 text-zinc-100 rounded-2xl rounded-tl-sm border border-zinc-800/40 max-w-[85%] px-4 py-3"
```

#### Input Area

```
className="relative bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/40 rounded-2xl shadow-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-600/50 transition-all"
```

#### Code Blocks

```
className="bg-[#242427] text-zinc-100 p-3 rounded-lg overflow-x-auto text-sm font-mono border border-zinc-800/40"
```

**Copy Button (hidden by default, appears on hover):**
```
className="absolute top-2 right-2 p-1.5 rounded-md bg-zinc-800/80 opacity-0 group-hover:opacity-100 transition-opacity"
```

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

- All API keys are encrypted using AES-256-CBC before database storage
- Encrypted key format: `<32-char IV>:<encrypted data>`
- Encryption key generated at service startup (store securely in env)

### RBAC Permissions

| Role | Permissions |
|------|-------------|
| user | Read chats, send messages, view usage analytics |
| admin | All user permissions + manage users, configure providers |

---

## Configuration Guide

### Environment Variables

Create `.env` file in project root:

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/aurora_gateway"
DATABASE_HOST="localhost"
DATABASE_PORT="5432"
DATABASE_NAME="aurora_gateway"
DATABASE_USER="postgres"
DATABASE_PASSWORD="postgres"

# Authentication
JWT_SECRET="your-jwt-secret-key-here-minimum-32-chars"
API_KEY_ENCRYPTION_KEY="encryption-key-minimum-32-chars"

# API Gateway - Provider configs (use env vars to set actual keys)
OPENAI_API_KEY="sk-your-openai-api-key"
ANTHROPIC_API_KEY="your-anthropic-api-key"
OLLAMA_API_BASE="http://localhost:11434"
OLLAMA_API_KEY=""  # Ollama doesn't require API key for local models

# Server
PORT="3000"
NODE_ENV="development"

# Backup (optional S3-compatible storage)
BACKUP_BUCKET_NAME="aurora-backups"
BACKUP_AWS_REGION="us-east-1"
BACKUP_ACCESS_KEY_ID=""  # Leave empty for local backups
BACKUP_SECRET_ACCESS_KEY=""  # Leave empty for local backups
```

### Database Setup

1. Start PostgreSQL (with Docker):
   ```bash
   docker run -d \
     -e POSTGRES_DB=aurora_gateway \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -p 5432:5432 \
     postgres
   ```

2. Run migrations:
   ```bash
   npx prisma migrate dev --name init
   ```

3. Generate Prisma Client:
   ```bash
   npx prisma generate
   ```

### Backup Configuration

For automated backups using pg_dump:

```bash
# Add to package.json scripts:
"scripts": {
  "backup-local": "./node_modules/.bin/pg_dump -h localhost -U postgres aurora_gateway > /backups/aurora_$(date +%Y%m%d).sql",
  "backup-upload": "aws s3 cp backup.sql s3://$BACKUP_BUCKET_NAME/ --region $BACKUP_AWS_REGION"
}
```

---

## Running the Application

### Development

```bash
# From project root:
cd packages/api-gateway && npm install
cd ../../apps/web && npm install

# Start all services:
cd packages/api-gateway && npm run dev
cd apps/web && npm run dev
```

### Production Build

```bash
# Build all packages:
turbo run build

# Start production server:
npm run start
```

---

## Extending the Gateway

### Adding a New Model Provider

1. **Create provider adapter:**
   ```javascript
   // packages/api-gateway/src/adapters/middleware-models.js
   export class MiddlewareModelProviders {
     static PROVIDER_ID = 'ollama-middleware-model' as const;
     
     async connect() {
       return { baseUrl: process.env.OLLAMA_API_BASE };
     }
     
     async chatCompletion(messages) {
       // Implement proxy logic
     }
   }
   ```

2. **Register in model router:**
   ```javascript
   // Register in model-router.js with priority config
   ```

3. **Add type definitions to shared/types/index.js**

---

## Support & Contributing

For issues, questions, or contributions, please open a GitHub issue.

---

*Last updated: June 2024*