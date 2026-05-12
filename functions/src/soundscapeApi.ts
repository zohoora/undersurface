import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { ALLOWED_ORIGINS } from './shared/cors.js'
import { elevenLabsKey } from './shared/secrets.js'
import { verifyAuth } from './shared/auth.js'
import { promptHash, isValidPrompt } from './soundscape/normalize.js'
import { createElevenLabsProvider, ProviderError } from './soundscape/provider.js'
import { getOrCreateSoundscape, SIDECAR_COLLECTION as SOUNDSCAPE_COLLECTION } from './soundscape/cache.js'
import { buildSoundscapeLimiters } from './soundscape/limits.js'

const soundscapeLimiters = buildSoundscapeLimiters()

export const soundscapeApi = onRequest(
  {
    secrets: [elevenLabsKey],
    cors: ALLOWED_ORIGINS,
    memory: '256MiB',
    // No minInstances — generation is a once-per-session preflight; the
    // settings panel masks any cold-start latency behind its loading state.
    timeoutSeconds: 60,
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }
    const uid = await verifyAuth(req.headers.authorization)
    if (!uid) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    // Soft request limiter first — counts cache hits too, bounds enumeration.
    if (!soundscapeLimiters.request(uid)) {
      res.status(429).json({ error: 'Too many soundscape requests. Try again in a bit.' })
      return
    }

    const { prompt } = (req.body || {}) as { prompt?: unknown }
    if (typeof prompt !== 'string') {
      res.status(400).json({ error: 'Missing prompt' })
      return
    }
    const validation = isValidPrompt(prompt)
    if (!validation.ok) {
      res.status(400).json({ error: 'Invalid prompt', reason: validation.reason })
      return
    }

    const hash = promptHash(prompt)
    const sidecarSnap = await getFirestore().collection(SOUNDSCAPE_COLLECTION).doc(hash).get()
    const isCacheHit = sidecarSnap.exists

    // Hard generation limiter only fires for actual ElevenLabs calls. Hits
    // are free; users can replay any cached prompt as much as they like
    // (subject to the soft request limiter above).
    if (!isCacheHit && !soundscapeLimiters.generate(uid)) {
      res.status(429).json({ error: 'Generation limit reached. Try a previously-used prompt or wait an hour.' })
      return
    }

    try {
      const provider = createElevenLabsProvider({ apiKey: elevenLabsKey.value() })
      // Pass the snapshot through so cache.ts skips a redundant Firestore read.
      const result = await getOrCreateSoundscape({ hash, prompt: prompt.trim(), provider, sidecarSnap })
      res.json(result)
    } catch (err) {
      if (err instanceof ProviderError) {
        const status = err.status >= 500 ? 502 : err.status
        console.error(`[soundscape] provider error status=${err.status}`, err.body?.slice(0, 200))
        res.status(status).json({ error: 'Soundscape generation failed' })
        return
      }
      console.error('[soundscape] unexpected error', err)
      res.status(500).json({ error: 'Soundscape service error' })
    }
  },
)
