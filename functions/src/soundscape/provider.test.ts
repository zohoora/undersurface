import { describe, it, expect, vi } from 'vitest'
import { createElevenLabsProvider, ProviderError } from './provider'

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>): typeof fetch {
  return vi.fn(impl) as unknown as typeof fetch
}

function audioResponse(byteLength: number, status = 200): Response {
  const buf = new Uint8Array(byteLength)
  buf[0] = 0x49 // 'I' for ID3
  buf[1] = 0x44 // 'D'
  buf[2] = 0x33 // '3'
  return new Response(buf, { status, headers: { 'Content-Type': 'audio/mpeg' } })
}

describe('ElevenLabs provider', () => {
  it('returns audio bytes on success', async () => {
    const fetcher = mockFetch(async () => audioResponse(2048))
    const provider = createElevenLabsProvider({ apiKey: 'k', fetcher })
    const result = await provider.generate('rain')
    expect(result.bytes.length).toBe(2048)
    expect(result.mime).toBe('audio/mpeg')
    expect(result.durationSec).toBe(30)
  })

  it('passes prompt + auth header in the request', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetcher = mockFetch(async (url, init) => {
      calls.push({ url, init })
      return audioResponse(1024)
    })
    const provider = createElevenLabsProvider({ apiKey: 'secret-123', fetcher })
    await provider.generate('rain on tin roof')
    expect(calls).toHaveLength(1)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['xi-api-key']).toBe('secret-123')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.text).toBe('rain on tin roof')
    expect(body.loop).toBe(true)
    expect(body.duration_seconds).toBe(30)
  })

  it('retries once on 5xx and succeeds', async () => {
    let calls = 0
    const fetcher = mockFetch(async () => {
      calls++
      return calls === 1 ? new Response('upstream busy', { status: 503 }) : audioResponse(512)
    })
    const provider = createElevenLabsProvider({ apiKey: 'k', fetcher })
    const result = await provider.generate('rain')
    expect(result.bytes.length).toBe(512)
    expect(calls).toBe(2)
  })

  it('does NOT retry on 4xx — surfaces error immediately', async () => {
    let calls = 0
    const fetcher = mockFetch(async () => {
      calls++
      return new Response('bad prompt', { status: 400 })
    })
    const provider = createElevenLabsProvider({ apiKey: 'k', fetcher })
    await expect(provider.generate('rain')).rejects.toBeInstanceOf(ProviderError)
    expect(calls).toBe(1)
  })

  it('throws ProviderError after both retries fail on 5xx', async () => {
    let calls = 0
    const fetcher = mockFetch(async () => {
      calls++
      return new Response('upstream busy', { status: 502 })
    })
    const provider = createElevenLabsProvider({ apiKey: 'k', fetcher })
    await expect(provider.generate('rain')).rejects.toMatchObject({
      name: 'ProviderError',
      status: 502,
    })
    expect(calls).toBe(2)
  })

  it('throws when response body is empty', async () => {
    const fetcher = mockFetch(async () => audioResponse(0))
    const provider = createElevenLabsProvider({ apiKey: 'k', fetcher })
    await expect(provider.generate('rain')).rejects.toMatchObject({
      name: 'ProviderError',
      message: expect.stringContaining('Empty audio'),
    })
  })

  it('honors durationSec override', async () => {
    const calls: RequestInit[] = []
    const fetcher = mockFetch(async (_, init) => {
      calls.push(init)
      return audioResponse(1024)
    })
    const provider = createElevenLabsProvider({ apiKey: 'k', fetcher, durationSec: 22 })
    await provider.generate('rain')
    const body = JSON.parse(calls[0].body as string)
    expect(body.duration_seconds).toBe(22)
  })
})
