import { getStorage } from 'firebase-admin/storage'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type { SoundscapeProvider } from './provider'

// Firestore sidecar collection. Top-level (not under users/) because the cache
// is shared across the userbase by content hash. Default-deny in
// firestore.rules covers writes from clients.
const SIDECAR_COLLECTION = 'soundscapes'

// Storage path within the default bucket.
function storagePath(hash: string): string {
  return `soundscapes/${hash}.mp3`
}

const SIGNED_URL_TTL_MS = 60 * 60 * 1000 // 1 hour
// 30-day browser/CDN cache for the underlying bytes. Each new signed URL
// looks unique (different signature) but the file behind it is stable, so
// downstream caches can serve from disk.
const CACHE_CONTROL = 'public, max-age=2592000'

// Cost recorded per generation for monthly accounting. ElevenLabs SFX V2 is
// ~$0.05 per clip — we record in cents so the dashboard math is integer-safe.
const GENERATION_COST_CENTS = 5

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

export async function getOrCreateSoundscape(opts: { hash: string; prompt: string; provider: SoundscapeProvider }): Promise<CachedSoundscape> {
  const { hash, prompt, provider } = opts
  const bucket = getStorage().bucket()
  const file = bucket.file(storagePath(hash))
  const sidecarRef = getFirestore().collection(SIDECAR_COLLECTION).doc(hash)

  // Mint a signed URL with v4 signing. 1-hour TTL covers a relax session and
  // a small post-settings delay before Begin.
  const mintUrl = async (): Promise<{ url: string; expiresAt: number }> => {
    const expiresAt = Date.now() + SIGNED_URL_TTL_MS
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    })
    return { url, expiresAt }
  }

  const sidecarSnap = await sidecarRef.get()
  if (sidecarSnap.exists) {
    // Sidecar present → assume Storage object exists. Bump access counters
    // (used by the lifecycle pruning job to evict stale entries) and mint
    // a fresh signed URL.
    const [exists] = await file.exists()
    if (exists) {
      void sidecarRef.update({
        lastAccessedAt: Date.now(),
        hitCount: FieldValue.increment(1),
      }).catch(() => { /* non-fatal */ })
      // Touch customTime so the Storage lifecycle rule sees this object as fresh.
      void file.setMetadata({ customTime: new Date().toISOString() }).catch(() => { /* non-fatal */ })
      const { url, expiresAt } = await mintUrl()
      return { url, cached: true, hash, expiresAt }
    }
    // Sidecar exists but file is missing — drift. Re-generate to self-heal.
    console.warn('[soundscape] sidecar/file drift, regenerating', hash)
  }

  // Cache miss: generate, upload, write sidecar.
  const audio = await provider.generate(prompt)
  await file.save(audio.bytes, {
    metadata: {
      contentType: audio.mime,
      cacheControl: CACHE_CONTROL,
      customTime: new Date().toISOString(),
    },
    resumable: false,
  })
  const sidecar: SidecarDoc = {
    hash,
    prompt,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    hitCount: 1,
    generationCostCents: GENERATION_COST_CENTS,
    sourceProvider: 'elevenlabs_sfx_v2',
  }
  await sidecarRef.set(sidecar)
  const { url, expiresAt } = await mintUrl()
  return { url, cached: false, hash, expiresAt }
}
