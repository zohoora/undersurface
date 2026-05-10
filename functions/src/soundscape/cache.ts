import { getStorage } from 'firebase-admin/storage'
import { getFirestore, FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore'
import type { SoundscapeProvider } from './provider.js'

// Firestore sidecar collection. Top-level (not under users/) because the cache
// is shared across the userbase by content hash. Default-deny in
// firestore.rules covers writes from clients.
export const SIDECAR_COLLECTION = 'soundscapes'

// 30-day browser/CDN cache for the underlying bytes. The signed URL changes
// per request (different signature) but the file behind it is stable.
const CACHE_CONTROL = 'public, max-age=2592000'

// 1-hour signed URL TTL — covers a relax session and a small panel-to-Begin delay.
const SIGNED_URL_TTL_MS = 60 * 60 * 1000

// Cost recorded per generation for monthly accounting. ElevenLabs SFX V2 is
// ~$0.05 per clip — recorded in cents so dashboard math is integer-safe.
const GENERATION_COST_CENTS = 5

// Skip lastAccessedAt + customTime touches if the doc was already touched
// within this window — keeps hot prompts from generating thousands of
// no-op writes per minute.
const ACCESS_TOUCH_THROTTLE_MS = 60 * 1000

function storagePath(hash: string): string {
  return `soundscapes/${hash}.mp3`
}

export interface CachedSoundscape {
  url: string
  cached: boolean
  hash: string
  expiresAt: number
}

interface SidecarDoc {
  hash: string
  prompt: string
  createdAt: number
  lastAccessedAt: number
  hitCount: number
  generationCostCents: number
  sourceProvider: string
}

export async function getOrCreateSoundscape(opts: {
  hash: string
  prompt: string
  provider: SoundscapeProvider
  // Optional: if the caller already fetched the sidecar (e.g. to gate rate
  // limiting on cache miss), pass it through to avoid a second round-trip.
  sidecarSnap?: DocumentSnapshot
}): Promise<CachedSoundscape> {
  const { hash, prompt, provider } = opts
  const bucket = getStorage().bucket()
  const file = bucket.file(storagePath(hash))
  const sidecarRef = getFirestore().collection(SIDECAR_COLLECTION).doc(hash)

  const mintUrl = async () => {
    const expiresAt = Date.now() + SIGNED_URL_TTL_MS
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt })
    return { url, expiresAt }
  }

  const sidecarSnap = opts.sidecarSnap ?? await sidecarRef.get()

  if (sidecarSnap.exists) {
    // Trust the sidecar — skip file.exists(). If the file is missing
    // (rare drift), the signed URL will 404 on fetch and the next
    // request can self-heal. The savings on every other hit are worth
    // the rare miss.
    //
    // Throttle access touches: a hot prompt would otherwise generate
    // hundreds of no-op writes per minute. Skip if last touch < 60s ago.
    const last = sidecarSnap.get('lastAccessedAt') as number | undefined
    if (typeof last !== 'number' || Date.now() - last >= ACCESS_TOUCH_THROTTLE_MS) {
      void Promise.all([
        sidecarRef.update({
          lastAccessedAt: Date.now(),
          hitCount: FieldValue.increment(1),
        }),
        file.setMetadata({ customTime: new Date().toISOString() }),
      ]).catch(() => { /* non-fatal telemetry */ })
    }
    const { url, expiresAt } = await mintUrl()
    return { url, cached: true, hash, expiresAt }
  }

  // Cache miss: generate, then upload + write sidecar concurrently.
  const audio = await provider.generate(prompt)
  const sidecar: SidecarDoc = {
    hash,
    prompt,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    hitCount: 1,
    generationCostCents: GENERATION_COST_CENTS,
    sourceProvider: 'elevenlabs_sfx_v2',
  }
  await Promise.all([
    file.save(audio.bytes, {
      metadata: {
        contentType: audio.mime,
        cacheControl: CACHE_CONTROL,
        customTime: new Date().toISOString(),
      },
      resumable: false,
    }),
    sidecarRef.set(sidecar),
  ])
  const { url, expiresAt } = await mintUrl()
  return { url, cached: false, hash, expiresAt }
}

