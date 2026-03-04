# MCP Server for UnderSurface

## Overview

Add an MCP (Model Context Protocol) server so users' AI agents can read their diary entries and conversation transcripts from UnderSurface. Read-only, 4 tools, API key auth, deployed as a Firebase Cloud Function.

## Architecture

**Approach:** Stateless MCP server as a new Firebase Cloud Function (`mcpApi`). Each request creates a fresh `McpServer` via the MCP TypeScript SDK's `NodeStreamableHTTPServerTransport` with `sessionIdGenerator: undefined`. No session management needed.

**Why stateless:** Cloud Functions are inherently stateless. The MCP SDK supports this mode natively — each POST creates a server, handles the request, and terminates. Perfect for read-only tools.

```
Agent (Claude, etc.)
  │  Authorization: Bearer us_a1b2c3...
  POST /api/mcp
  │
mcpApi Cloud Function
  ├── Hash API key → query Firestore to resolve uid
  ├── Rate limit (60/min per key)
  ├── Create stateless McpServer with 4 tools
  ├── Tools query Firestore scoped to uid
  └── Return JSON response via MCP transport
```

## Authentication

### API Key Model

- **Format:** `us_` prefix + 32 random bytes (hex) = 67 characters
- **Storage:** `users/{uid}/apiKeys/{keyId}` → `{ hash: SHA-256, name: string, createdAt: number, lastUsedAt: number }`
- **Limit:** One active key per user (can expand later)
- **Lookup:** Hash incoming key, query `collectionGroup('apiKeys')` for matching hash → resolves to uid
- **Rate limit:** 60 requests/minute per key

### User Flow

1. Settings → Developer → "Generate API Key"
2. Key shown once, copyable, with "won't be shown again" warning
3. Below: key name, created date, Revoke button
4. Configure agent with the key

## MCP Tools

| Tool | Input | Returns |
|------|-------|---------|
| `list-entries` | `{ limit?, offset?, since?, search? }` | Array of `{ id, createdAt, updatedAt, preview, intention, wordCount }` |
| `get-entry` | `{ entryId }` | `{ id, plainText, createdAt, updatedAt, intention, themes?, emotionalArc? }` |
| `list-conversations` | `{ limit?, since?, status? }` | Array of `{ id, startedAt, endedAt, hostPartId, phase, messageCount, firstLine, isTherapistSession }` |
| `get-conversation` | `{ sessionId }` | Session metadata + messages array `{ speaker, partName, content, timestamp, phase }` |

All tools are read-only. Input validated with Zod schemas.

## Cloud Function Config

- **Name:** `mcpApi`
- **Memory:** 256 MiB
- **Timeout:** 30s
- **Region:** us-central1
- **CORS:** open (MCP clients connect from anywhere)
- **No minInstances** (not latency-critical)

## Dependencies

Added to `functions/package.json`:
- `@modelcontextprotocol/sdk` (MCP TypeScript SDK)
- `zod` (tool input schemas)

## Frontend Changes

### Settings Panel

- New "Developer" section at bottom of Settings
- "Generate API Key" button → generates key, stores hash in Firestore, displays key once
- Active key display: name + created date + Revoke button
- Only one key at a time

### Firestore Rules

- `users/{uid}/apiKeys/{keyId}`: read/write only by owner (same as other subcollections)

## Agent Configuration Example

```json
{
  "mcpServers": {
    "undersurface": {
      "type": "streamable-http",
      "url": "https://undersurface.me/api/mcp",
      "headers": {
        "Authorization": "Bearer us_a1b2c3..."
      }
    }
  }
}
```

## Decisions

- **Stateless over stateful:** Cloud Functions are ephemeral. Stateless MCP avoids session storage complexity.
- **API key over Firebase token:** Agents can't easily do Firebase Auth flows. Long-lived API keys are the standard pattern for machine-to-machine auth.
- **One key per user:** Simplest model. Multi-key management is YAGNI for now.
- **Read-only:** Write access (creating memories, entries) adds complexity and risk. Start read-only, expand later.
- **No search tool:** Firestore doesn't support full-text search natively. `list-entries` with `since` filter covers the primary use case. Semantic search would require Algolia or similar.
