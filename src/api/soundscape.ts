import { getAuthToken } from './authedFetch'
import { apiUrl } from './apiBase'

export interface SoundscapeResult {
  url: string
  cached: boolean
  hash: string
  expiresAt: number
}

export type SoundscapeErrorKind = 'rate_limit' | 'validation' | 'provider' | 'network' | 'auth' | 'unknown'

// Typed errors so the UI can show different copy per failure mode.
export class SoundscapeError extends Error {
  readonly kind: SoundscapeErrorKind
  constructor(kind: SoundscapeErrorKind, message: string) {
    super(message)
    this.name = 'SoundscapeError'
    this.kind = kind
  }
}

// POST /api/soundscape with the current user's bearer token. Surfaces typed
// errors keyed off HTTP status so the panel can route to the right copy.
export async function generateSoundscape(prompt: string, signal?: AbortSignal): Promise<SoundscapeResult> {
  let token: string
  try {
    token = await getAuthToken()
  } catch {
    throw new SoundscapeError('auth', 'Not authenticated')
  }

  let response: Response
  try {
    response = await fetch(apiUrl('/api/soundscape'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
      signal,
    })
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') throw err
    throw new SoundscapeError('network', 'Network error')
  }

  if (!response.ok) {
    if (response.status === 401) throw new SoundscapeError('auth', 'Not authenticated')
    if (response.status === 429) throw new SoundscapeError('rate_limit', 'Rate limit reached')
    if (response.status === 400) throw new SoundscapeError('validation', 'Invalid prompt')
    if (response.status >= 500 && response.status < 600) throw new SoundscapeError('provider', 'Service unavailable')
    throw new SoundscapeError('unknown', `HTTP ${response.status}`)
  }

  return response.json() as Promise<SoundscapeResult>
}
