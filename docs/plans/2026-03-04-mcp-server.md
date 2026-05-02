# MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an MCP server so users' AI agents can read diary entries and conversation transcripts via API key auth.

**Architecture:** Stateless MCP server as a new Firebase Cloud Function (`mcpApi`). API key auth with SHA-256 hashing, 4 read-only tools, rate limiting at 60 req/min. Key management UI in Settings → Developer section.

**Tech Stack:** Firebase Cloud Functions v2, `@modelcontextprotocol/sdk`, Zod, Firestore collectionGroup query for key lookup.

**Design doc:** `docs/plans/2026-03-04-mcp-server-design.md`

---

### Task 1: Install dependencies

**Files:**
- Modify: `functions/package.json`

**Step 1: Install MCP SDK and Zod**

```bash
cd functions && npm install @modelcontextprotocol/sdk zod
```

**Step 2: Verify TypeScript can resolve the packages**

Create a temporary test file to check imports compile:

```bash
cd functions && echo 'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
console.log(McpServer, StreamableHTTPServerTransport, z)' > src/_test_imports.ts && npx tsc --noEmit
```

If the imports fail, try alternative import paths:
- `@modelcontextprotocol/sdk` (root)
- `@modelcontextprotocol/sdk/server` (server subpath)

Once the correct import paths compile, delete the test file:

```bash
rm functions/src/_test_imports.ts
```

**Step 3: Commit**

```bash
git add functions/package.json functions/package-lock.json
git commit -m "chore: add @modelcontextprotocol/sdk and zod to functions"
```

---

### Task 2: Add Firestore index for apiKeys collection group query

The MCP server needs to look up API keys across all users via `collectionGroup('apiKeys').where('hash', '==', ...)`. This requires a collection group field override.

**Files:**
- Modify: `firestore.indexes.json`

**Step 1: Add the field override**

In `firestore.indexes.json`, add to the `fieldOverrides` array:

```json
{
  "collectionGroup": "apiKeys",
  "fieldPath": "hash",
  "indexes": [
    { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
  ]
}
```

The full file becomes:

```json
{
  "indexes": [],
  "fieldOverrides": [
    {
      "collectionGroup": "entries",
      "fieldPath": "updatedAt",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" },
        { "order": "DESCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    },
    {
      "collectionGroup": "apiKeys",
      "fieldPath": "hash",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

**Step 2: Commit**

```bash
git add firestore.indexes.json
git commit -m "chore: add Firestore index for apiKeys collection group query"
```

---

### Task 3: Add apiKeys collection proxy to db.ts

**Files:**
- Modify: `src/store/db.ts`

**Step 1: Add the proxy**

In `src/store/db.ts`, find the `db` export object (around line 110) and add `apiKeys`:

```typescript
export const db = {
  entries: createCollectionProxy('entries'),
  parts: createCollectionProxy('parts'),
  // ... existing proxies ...
  apiKeys: createCollectionProxy('apiKeys'),
}
```

**Step 2: Type-check**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/store/db.ts
git commit -m "feat: add apiKeys collection proxy to db"
```

---

### Task 4: Implement mcpApi Cloud Function

This is the core task. Add the MCP server as a new exported Cloud Function in `functions/src/index.ts`.

**Files:**
- Modify: `functions/src/index.ts`

**Step 1: Add imports and constants**

At the top of `functions/src/index.ts`, add after existing imports:

```typescript
import { createHash } from 'crypto'
```

Below the existing rate limit constants (around line 37), add:

```typescript
// ─── MCP API key auth + rate limiting ─────────────────────
const mcpRateLimitMap = new Map<string, { count: number; resetAt: number }>()
const MCP_RATE_LIMIT_MAX = 60

function checkMcpRateLimit(keyHash: string): boolean {
  const now = Date.now()
  const entry = mcpRateLimitMap.get(keyHash)
  if (!entry || now > entry.resetAt) {
    mcpRateLimitMap.set(keyHash, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= MCP_RATE_LIMIT_MAX
}

async function resolveApiKey(bearer: string): Promise<string | null> {
  if (!bearer.startsWith('us_') || bearer.length !== 67) return null
  const hash = createHash('sha256').update(bearer).digest('hex')
  const snap = await getFirestore()
    .collectionGroup('apiKeys')
    .where('hash', '==', hash)
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  // Path: users/{uid}/apiKeys/{keyId} → parent.parent = users/{uid}
  const uid = doc.ref.parent.parent?.id
  if (!uid) return null
  // Update lastUsedAt (fire-and-forget)
  doc.ref.update({ lastUsedAt: Date.now() }).catch(() => {})
  return uid
}
```

**Step 2: Add the mcpApi Cloud Function**

At the end of `functions/src/index.ts` (after the `adminApi` export), add:

```typescript
// ─── MCP API ──────────────────────────────────────────────

export const mcpApi = onRequest(
  {
    cors: true,
    memory: '256MiB',
    timeoutSeconds: 30,
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. Use POST.' },
        id: null,
      })
      return
    }

    // Authenticate via API key
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Missing API key. Use Authorization: Bearer us_...' },
        id: null,
      })
      return
    }

    const apiKey = authHeader.slice(7)
    const uid = await resolveApiKey(apiKey)
    if (!uid) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid API key' },
        id: null,
      })
      return
    }

    // Rate limit
    const keyHash = createHash('sha256').update(apiKey).digest('hex')
    if (!checkMcpRateLimit(keyHash)) {
      res.status(429).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Rate limit exceeded (60/min)' },
        id: null,
      })
      return
    }

    // Dynamic import for ESM compatibility
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    )
    const { z } = await import('zod')

    const server = new McpServer({
      name: 'undersurface',
      version: '1.0.0',
    })

    const db = getFirestore()
    const userRef = db.collection('users').doc(uid)

    // ── Tool: list-entries ──
    server.registerTool(
      'list-entries',
      {
        title: 'List Entries',
        description:
          'List diary entries with optional filters. Returns id, date, preview, intention, and word count.',
        inputSchema: {
          limit: z.number().int().min(1).max(100).default(20).describe('Max entries to return (1-100)'),
          offset: z.number().int().min(0).default(0).describe('Number of entries to skip'),
          since: z.string().optional().describe('ISO 8601 date. Only entries after this date.'),
        },
      },
      async ({ limit, offset, since }) => {
        let q = userRef
          .collection('entries')
          .orderBy('createdAt', 'desc')
        if (since) {
          const sinceMs = new Date(since).getTime()
          if (!isNaN(sinceMs)) {
            q = q.where('createdAt', '>', sinceMs)
          }
        }
        q = q.offset(offset).limit(limit)
        const snap = await q.get()
        const entries = snap.docs.map((d) => {
          const data = d.data()
          const plainText = (data.plainText as string) || ''
          return {
            id: d.id,
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
            preview: plainText.slice(0, 200),
            intention: data.intention || null,
            wordCount: plainText.split(/\s+/).filter(Boolean).length,
          }
        })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }],
        }
      },
    )

    // ── Tool: get-entry ──
    server.registerTool(
      'get-entry',
      {
        title: 'Get Entry',
        description: 'Get the full text and metadata of a specific diary entry.',
        inputSchema: {
          entryId: z.string().describe('The entry ID'),
        },
      },
      async ({ entryId }) => {
        const snap = await userRef.collection('entries').doc(entryId).get()
        if (!snap.exists) {
          return {
            content: [{ type: 'text' as const, text: 'Entry not found' }],
            isError: true,
          }
        }
        const data = snap.data()!
        const entry = {
          id: snap.id,
          plainText: data.plainText || '',
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null,
          intention: data.intention || null,
          themes: data.themes || null,
          emotionalArc: data.emotionalArc || null,
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(entry, null, 2) }],
        }
      },
    )

    // ── Tool: list-conversations ──
    server.registerTool(
      'list-conversations',
      {
        title: 'List Conversations',
        description:
          'List conversation sessions with optional filters. Returns metadata for each session.',
        inputSchema: {
          limit: z.number().int().min(1).max(100).default(20).describe('Max conversations to return'),
          since: z.string().optional().describe('ISO 8601 date. Only conversations after this date.'),
          status: z.enum(['active', 'closed']).optional().describe('Filter by status'),
        },
      },
      async ({ limit, since, status }) => {
        let q = userRef
          .collection('sessions')
          .orderBy('startedAt', 'desc')
        if (since) {
          const sinceMs = new Date(since).getTime()
          if (!isNaN(sinceMs)) {
            q = q.where('startedAt', '>', sinceMs)
          }
        }
        if (status) {
          q = q.where('status', '==', status)
        }
        q = q.limit(limit)
        const snap = await q.get()
        const sessions = snap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            startedAt: data.startedAt || null,
            endedAt: data.endedAt || null,
            hostPartId: data.hostPartId || null,
            phase: data.phase || null,
            messageCount: data.messageCount || 0,
            firstLine: data.firstLine || '',
            isTherapistSession: data.isTherapistSession ?? false,
          }
        })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(sessions, null, 2) }],
        }
      },
    )

    // ── Tool: get-conversation ──
    server.registerTool(
      'get-conversation',
      {
        title: 'Get Conversation',
        description:
          'Get a full conversation transcript including all messages.',
        inputSchema: {
          sessionId: z.string().describe('The session/conversation ID'),
        },
      },
      async ({ sessionId }) => {
        const sessionSnap = await userRef.collection('sessions').doc(sessionId).get()
        if (!sessionSnap.exists) {
          return {
            content: [{ type: 'text' as const, text: 'Conversation not found' }],
            isError: true,
          }
        }
        const sessionData = sessionSnap.data()!
        const msgSnap = await userRef
          .collection('sessions')
          .doc(sessionId)
          .collection('messages')
          .orderBy('timestamp', 'asc')
          .get()
        const messages = msgSnap.docs.map((d) => {
          const m = d.data()
          return {
            speaker: m.speaker || 'user',
            partName: m.partName || null,
            content: m.content || '',
            timestamp: m.timestamp || 0,
            phase: m.phase || null,
          }
        })
        const session = {
          id: sessionSnap.id,
          startedAt: sessionData.startedAt || null,
          endedAt: sessionData.endedAt || null,
          hostPartId: sessionData.hostPartId || null,
          phase: sessionData.phase || null,
          sessionNote: sessionData.sessionNote || null,
          isTherapistSession: sessionData.isTherapistSession ?? false,
          messages,
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(session, null, 2) }],
        }
      },
    )

    // Handle the MCP request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  },
)
```

**Step 3: Type-check**

```bash
cd functions && npx tsc
```

If the static imports fail due to ESM/CJS incompatibility, convert them to dynamic imports as shown above (using `await import()`). If the subpath imports (`@modelcontextprotocol/sdk/server/mcp.js`) don't resolve, try:
- `@modelcontextprotocol/sdk/server/mcp`
- `@modelcontextprotocol/sdk`

**Step 4: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: add mcpApi Cloud Function with 4 read-only tools"
```

---

### Task 5: Add firebase.json rewrite

**Files:**
- Modify: `firebase.json`

**Step 1: Add the MCP rewrite**

In `firebase.json`, add a new rewrite entry in the `rewrites` array, **before** the catch-all `"source": "**"` entry:

```json
{
  "source": "/api/mcp",
  "function": "mcpApi"
}
```

The rewrites array becomes:

```json
"rewrites": [
  { "source": "/api/chat", "function": "chat" },
  { "source": "/api/admin", "function": "adminApi" },
  { "source": "/api/account", "function": "accountApi" },
  { "source": "/api/mcp", "function": "mcpApi" },
  { "source": "**", "destination": "/index.html" }
]
```

**Step 2: Commit**

```bash
git add firebase.json
git commit -m "chore: add /api/mcp rewrite for mcpApi Cloud Function"
```

---

### Task 6: Add Developer section to SettingsPanel

**Files:**
- Modify: `src/components/Sidebar/SettingsPanel.tsx`

**Step 1: Add state and key generation logic**

Inside the `SettingsPanel` component, after the existing state declarations (around line 82), add:

```typescript
const [apiKey, setApiKey] = useState<{ id: string; name: string; createdAt: number } | null>(null)
const [apiKeyLoading, setApiKeyLoading] = useState(true)
const [generatedKey, setGeneratedKey] = useState<string | null>(null)
const [keyCopied, setKeyCopied] = useState(false)

// Load existing API key on mount
useEffect(() => {
  if (!user) return
  import('../../store/db').then(({ db }) => {
    db.apiKeys.toArray().then((keys: Array<Record<string, unknown>>) => {
      if (keys.length > 0) {
        const k = keys[0]
        setApiKey({
          id: k.id as string,
          name: (k.name as string) || 'Default',
          createdAt: k.createdAt as number,
        })
      }
      setApiKeyLoading(false)
    }).catch(() => setApiKeyLoading(false))
  })
}, [user])

const handleGenerateKey = async () => {
  // Generate random key: us_ + 32 hex bytes = 67 chars
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const rawKey = `us_${hex}`

  // Hash with SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))
  const hash = Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('')

  const keyId = crypto.randomUUID()
  const now = Date.now()
  const { db } = await import('../../store/db')
  await db.apiKeys.add({
    id: keyId,
    hash,
    name: 'Default',
    createdAt: now,
    lastUsedAt: null,
  })

  setApiKey({ id: keyId, name: 'Default', createdAt: now })
  setGeneratedKey(rawKey)
}

const handleRevokeKey = async () => {
  if (!apiKey) return
  const { db } = await import('../../store/db')
  await db.apiKeys.delete(apiKey.id)
  setApiKey(null)
  setGeneratedKey(null)
}
```

**Step 2: Add the Developer section UI**

In the JSX, add a new section **between the Autocorrect section and the Contact Us section** (around line 237, before `{/* Contact Us */}`):

```tsx
{/* Developer */}
<div className="settings-section">
  <div className="settings-section-label">Developer</div>
  {apiKeyLoading ? (
    <div style={{ fontSize: 11, color: 'var(--text-ghost)', padding: '4px 0' }}>
      Loading...
    </div>
  ) : generatedKey ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--color-tender)', lineHeight: 1.4 }}>
        Copy this key now — it won't be shown again.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          readOnly
          value={generatedKey}
          style={{
            flex: 1,
            fontFamily: 'monospace',
            fontSize: 10,
            padding: '6px 8px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            background: 'var(--surface-primary)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
          onFocus={(e) => e.target.select()}
        />
        <button
          onClick={() => {
            navigator.clipboard.writeText(generatedKey)
            setKeyCopied(true)
            setTimeout(() => setKeyCopied(false), 2000)
          }}
          style={{
            fontSize: 10,
            fontFamily: "'Inter', sans-serif",
            padding: '4px 10px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            background: 'var(--surface-primary)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {keyCopied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <button
        onClick={() => setGeneratedKey(null)}
        style={{
          fontSize: 11,
          fontFamily: "'Inter', sans-serif",
          color: 'var(--text-ghost)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left',
        }}
      >
        Done
      </button>
    </div>
  ) : apiKey ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
        API key active — created{' '}
        {new Date(apiKey.createdAt).toLocaleDateString()}
      </div>
      <button
        onClick={handleRevokeKey}
        style={{
          ...dataButtonBase,
          color: 'var(--color-tender)',
          borderColor: 'var(--color-tender)',
        }}
      >
        Revoke Key
      </button>
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-ghost)', lineHeight: 1.4 }}>
        Generate an API key to connect AI agents to your diary via MCP.
      </div>
      <button
        onClick={handleGenerateKey}
        style={{
          ...dataButtonBase,
          color: 'var(--text-primary)',
        }}
      >
        Generate API Key
      </button>
    </div>
  )}
</div>
```

**Step 3: Type-check and build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/components/Sidebar/SettingsPanel.tsx
git commit -m "feat: add Developer section with API key generation to Settings"
```

---

### Task 7: Build, deploy, and verify

**Step 1: Build everything**

```bash
npm run build && cd functions && npx tsc && cd ..
```

**Step 2: Deploy everything**

```bash
firebase deploy --force
```

**Step 3: Run smoke test**

```bash
npm run smoke-test
```

**Step 4: Test MCP endpoint manually**

Test that the endpoint responds to unauthenticated requests:

```bash
curl -X POST https://undersurface.me/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
```

Expected: 401 response with "Missing API key" error.

**Step 5: Test with a real API key**

1. Log in to undersurface.me
2. Go to Settings → Developer → Generate API Key
3. Copy the key
4. Test with curl:

```bash
curl -X POST https://undersurface.me/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer us_YOUR_KEY_HERE" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
```

Expected: 200 response with server capabilities including 4 tools.

**Step 6: Test with Claude Code**

Add to `~/.claude.json` or project settings:

```json
{
  "mcpServers": {
    "undersurface": {
      "type": "streamable-http",
      "url": "https://undersurface.me/api/mcp",
      "headers": {
        "Authorization": "Bearer us_YOUR_KEY_HERE"
      }
    }
  }
}
```

Restart Claude Code and verify the 4 tools appear. Try: "List my recent diary entries from UnderSurface."

**Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: MCP server for AI agent access to diary entries and conversations"
```
