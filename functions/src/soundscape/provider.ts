// ElevenLabs Sound Effects V2 provider. Generates a short looping audio clip
// from a natural-language prompt. The endpoint returns raw audio bytes.
//
// Docs: https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
//
// We pin output_format to mp3_44100_128 because the rest of the relax audio
// pipeline expects MP3 (so we don't need any transcoding) and the higher bit
// rate is barely 30% larger than 64kbps but sounds substantially better in
// looped ambient playback.

const ELEVENLABS_ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation'
const REQUEST_TIMEOUT_MS = 25_000
const RETRY_DELAY_MS = 1_000

export interface GeneratedAudio {
  bytes: Buffer
  mime: 'audio/mpeg'
  durationSec: number
}

export class ProviderError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

export interface SoundscapeProvider {
  generate(prompt: string): Promise<GeneratedAudio>
}

interface ProviderOptions {
  apiKey: string
  durationSec?: number
  promptInfluence?: number
  // Override fetch for testing. Defaults to globalThis.fetch (Node 22 has it).
  fetcher?: typeof fetch
}

export function createElevenLabsProvider(opts: ProviderOptions): SoundscapeProvider {
  const fetcher = opts.fetcher ?? fetch
  const durationSec = opts.durationSec ?? 30
  const promptInfluence = opts.promptInfluence ?? 0.7

  return {
    async generate(prompt: string): Promise<GeneratedAudio> {
      const body = JSON.stringify({
        text: prompt,
        duration_seconds: durationSec,
        loop: true,
        prompt_influence: promptInfluence,
        output_format: 'mp3_44100_128',
      })

      // Retry once on 5xx with a 1s delay. ElevenLabs occasionally returns
      // transient 502/503 during peak load; a single retry covers most cases
      // without amplifying outages.
      let lastErr: ProviderError | null = null
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS))

        const res = await fetcher(ELEVENLABS_ENDPOINT, {
          method: 'POST',
          headers: {
            'xi-api-key': opts.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })

        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer())
          if (buffer.length === 0) {
            throw new ProviderError('Empty audio response from provider', 502)
          }
          return { bytes: buffer, mime: 'audio/mpeg', durationSec }
        }

        const errBody = await res.text().catch(() => '')
        lastErr = new ProviderError(`ElevenLabs ${res.status}: ${errBody.slice(0, 200)}`, res.status, errBody)

        // Only retry on 5xx. 4xx errors (bad prompt, auth) won't be fixed by retrying.
        if (res.status < 500) break
      }
      throw lastErr ?? new ProviderError('Unknown provider error', 500)
    },
  }
}
