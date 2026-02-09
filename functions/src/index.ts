import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

initializeApp()

const openRouterKey = defineSecret('OPENROUTER_API_KEY')

export const chat = onRequest(
  {
    secrets: [openRouterKey],
    cors: true,
    memory: '256MiB',
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    // Verify Firebase auth token
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing auth token' })
      return
    }

    try {
      await getAuth().verifyIdToken(authHeader.split('Bearer ')[1])
    } catch {
      res.status(401).json({ error: 'Invalid auth token' })
      return
    }

    const { messages, model, max_tokens, temperature, stream } = req.body

    const openRouterResponse = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey.value()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://undersurface.me',
          'X-Title': 'UnderSurface',
        },
        body: JSON.stringify({
          model: model || 'google/gemini-3-flash-preview',
          messages,
          max_tokens: max_tokens || 150,
          temperature: temperature ?? 0.9,
          stream: !!stream,
        }),
      },
    )

    if (!openRouterResponse.ok) {
      const errorBody = await openRouterResponse.text().catch(() => '')
      res.status(openRouterResponse.status).json({
        error: `OpenRouter error: ${openRouterResponse.status}`,
        details: errorBody,
      })
      return
    }

    if (stream && openRouterResponse.body) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('X-Accel-Buffering', 'no')

      const reader = openRouterResponse.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
      } finally {
        res.end()
      }
    } else {
      const data = await openRouterResponse.json()
      res.json(data)
    }
  },
)
