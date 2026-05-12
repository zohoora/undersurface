import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import { makeRateLimiter } from './shared/rateLimit.js'

// Separate rate limit for MCP: 60 req/min per API key hash
const checkMcpRateLimit = makeRateLimiter({ windowMs: 60_000, max: 60 })

async function resolveApiKey(bearer: string): Promise<{ uid: string; keyHash: string } | null> {
  // Validate format: must start with us_ and be 67 chars total
  if (!bearer.startsWith('us_') || bearer.length !== 67) return null

  const keyHash = createHash('sha256').update(bearer).digest('hex')
  const db = getFirestore()

  // Query across all users' apiKeys subcollections
  const snap = await db.collectionGroup('apiKeys')
    .where('hash', '==', keyHash)
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]
  // Path: users/{uid}/apiKeys/{keyId} — parent.parent is the user doc
  const uid = doc.ref.parent.parent?.id
  if (!uid) return null

  // Fire-and-forget: update lastUsedAt
  doc.ref.update({ lastUsedAt: Date.now() }).catch(err => {
    console.warn('Failed to update apiKey lastUsedAt:', err)
  })

  return { uid, keyHash }
}

export const mcpApi = onRequest(
  {
    cors: true, // MCP clients connect from anywhere (not browser-based)
    memory: '256MiB',
    timeoutSeconds: 30,
    region: 'us-central1',
  },
  async (req, res) => {
    // JSON-RPC error helper
    const jsonRpcError = (code: number, message: string, status: number) => {
      res.status(status).json({
        jsonrpc: '2.0',
        error: { code, message },
        id: null,
      })
    }

    // POST only
    if (req.method !== 'POST') {
      jsonRpcError(-32000, 'Method not allowed — POST required', 405)
      return
    }

    // Auth: extract API key from Authorization header
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      jsonRpcError(-32000, 'Missing or invalid Authorization header', 401)
      return
    }

    const apiKey = authHeader.slice(7)
    const resolved = await resolveApiKey(apiKey)
    if (!resolved) {
      jsonRpcError(-32000, 'Invalid API key', 401)
      return
    }

    // Rate limit by key hash
    if (!checkMcpRateLimit(resolved.keyHash)) {
      jsonRpcError(-32000, 'Rate limit exceeded — 60 requests per minute', 429)
      return
    }

    const uid = resolved.uid

    // Dynamic imports to avoid ESM/CJS issues
    const [{ McpServer }, { StreamableHTTPServerTransport }, { z }] = await Promise.all([
      import('@modelcontextprotocol/sdk/server/mcp.js'),
      import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
      import('zod'),
    ])

    const server = new McpServer({
      name: 'undersurface',
      version: '1.0.0',
    })

    const db = getFirestore()

    // ── Tool: list-entries ──────────────────────────────────
    server.tool(
      'list-entries',
      'List diary entries with optional filtering',
      {
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        since: z.string().optional(),
      },
      async (args) => {
        let query = db.collection('users').doc(uid).collection('entries')
          .orderBy('createdAt', 'desc') as FirebaseFirestore.Query

        if (args.since) {
          const sinceMs = new Date(args.since).getTime()
          if (!isNaN(sinceMs)) {
            query = query.where('createdAt', '>', sinceMs)
          }
        }

        const snap = await query.offset(args.offset).limit(args.limit).get()
        const docs = snap.docs

        const entries = docs.map((d) => {
          const data = d.data()
          const plainText = (data.plainText as string) || ''
          return {
            id: (data.id as string) || d.id,
            createdAt: data.createdAt || 0,
            updatedAt: data.updatedAt || 0,
            preview: plainText.slice(0, 200),
            intention: data.intention || null,
            wordCount: plainText.split(/\s+/).filter((w: string) => w.length > 0).length,
          }
        })

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(entries) }],
        }
      },
    )

    // ── Tool: get-entry ─────────────────────────────────────
    server.tool(
      'get-entry',
      'Get a single diary entry by ID',
      {
        entryId: z.string(),
      },
      async (args) => {
        const snap = await db.collection('users').doc(uid).collection('entries').doc(args.entryId).get()

        if (!snap.exists) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Entry not found: ${args.entryId}` }],
          }
        }

        const data = snap.data()!
        const entry = {
          id: snap.id,
          plainText: (data.plainText as string) || '',
          createdAt: data.createdAt || 0,
          updatedAt: data.updatedAt || 0,
          intention: data.intention || null,
          themes: data.themes || null,
          emotionalArc: data.emotionalArc || null,
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(entry) }],
        }
      },
    )

    // ── Tool: list-conversations ────────────────────────────
    server.tool(
      'list-conversations',
      'List conversation sessions with optional filtering',
      {
        limit: z.number().int().min(1).max(100).default(20),
        since: z.string().optional(),
        status: z.enum(['active', 'closed']).optional(),
      },
      async (args) => {

        let query = db.collection('users').doc(uid).collection('sessions')
          .orderBy('startedAt', 'desc') as FirebaseFirestore.Query

        if (args.since) {
          const sinceMs = new Date(args.since).getTime()
          if (!isNaN(sinceMs)) {
            query = query.where('startedAt', '>', sinceMs)
          }
        }

        if (args.status) {
          query = query.where('status', '==', args.status)
        }

        const snap = await query.limit(args.limit).get()

        const conversations = snap.docs.map((d) => {
          const data = d.data()
          return {
            id: (data.id as string) || d.id,
            startedAt: data.startedAt || 0,
            endedAt: data.endedAt || null,
            hostPartId: data.hostPartId || '',
            phase: data.phase || 'opening',
            messageCount: data.messageCount || 0,
            firstLine: data.firstLine || '',
            isTherapistSession: data.isTherapistSession ?? true,
          }
        })

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(conversations) }],
        }
      },
    )

    // ── Tool: get-conversation ──────────────────────────────
    server.tool(
      'get-conversation',
      'Get a conversation session with all messages',
      {
        sessionId: z.string(),
      },
      async (args) => {
        const sessionRef = db.collection('users').doc(uid).collection('sessions').doc(args.sessionId)
        const sessionSnap = await sessionRef.get()

        if (!sessionSnap.exists) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Conversation not found: ${args.sessionId}` }],
          }
        }

        const data = sessionSnap.data()!
        const messagesSnap = await sessionRef.collection('messages')
          .orderBy('timestamp', 'asc')
          .get()

        const messages = messagesSnap.docs.map((d) => {
          const m = d.data()
          return {
            speaker: m.speaker || 'user',
            partName: m.partName || null,
            content: m.content || '',
            timestamp: m.timestamp || 0,
            phase: m.phase || 'opening',
          }
        })

        const conversation = {
          id: (data.id as string) || sessionSnap.id,
          startedAt: data.startedAt || 0,
          endedAt: data.endedAt || null,
          hostPartId: data.hostPartId || '',
          phase: data.phase || 'opening',
          sessionNote: data.sessionNote || null,
          isTherapistSession: data.isTherapistSession ?? true,
          messages,
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(conversation) }],
        }
      },
    )

    // Connect via stateless StreamableHTTP transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    await server.connect(transport)

    await transport.handleRequest(req, res, req.body)
  },
)
