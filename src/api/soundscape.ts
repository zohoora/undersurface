import { getAuthToken } from './authedFetch'
import { apiUrl } from './apiBase'

export interface SoundscapeResult {
  url: string
  cached: boolean
  hash: string
  expiresAt: number
}

export type SoundscapeErrorKind = 'rate_limit' | 'validation' | 'provider' | 'network' | 'auth' | 'unknown'

const DEFAULT_MESSAGES: Record<SoundscapeErrorKind, string> = {
  rate_limit: 'Rate limit reached',
  validation: 'Invalid prompt',
  provider: 'Service unavailable',
  network: 'Network error',
  auth: 'Not authenticated',
  unknown: 'Unknown error',
}

// Typed errors so the UI can show different copy per failure mode.
export class SoundscapeError extends Error {
  readonly kind: SoundscapeErrorKind
  constructor(kind: SoundscapeErrorKind, message?: string) {
    super(message ?? DEFAULT_MESSAGES[kind])
    this.name = 'SoundscapeError'
    this.kind = kind
  }
}

export async function generateSoundscape(prompt: string, signal?: AbortSignal): Promise<SoundscapeResult> {
  let token: string
  try {
    token = await getAuthToken()
  } catch {
    throw new SoundscapeError('auth')
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
    throw new SoundscapeError('network')
  }

  if (!response.ok) {
    if (response.status === 401) throw new SoundscapeError('auth')
    if (response.status === 429) throw new SoundscapeError('rate_limit')
    if (response.status === 400) throw new SoundscapeError('validation')
    if (response.status >= 500) throw new SoundscapeError('provider')
    throw new SoundscapeError('unknown', `HTTP ${response.status}`)
  }

  return response.json() as Promise<SoundscapeResult>
}
