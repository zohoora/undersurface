import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_MMS_IMAGES,
  MAX_MMS_TOTAL_BYTES,
  fetchTwilioImages,
  isExpectedTwilioMediaUrl,
  parseTwilioMedia,
} from './media'

const ACCOUNT_SID = 'AC1234567890abcdef1234567890abcdef'
const MESSAGE_SID = 'MM1234567890abcdef1234567890abcdef'

function mediaUrl(mediaSid = 'ME1234567890abcdef1234567890abcdef') {
  return `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${MESSAGE_SID}/Media/${mediaSid}`
}

function imageResponse(bytes: number[], contentType = 'image/png', contentLength = bytes.length): Response {
  return {
    ok: true,
    headers: new Headers({
      'content-type': contentType,
      'content-length': String(contentLength),
    }),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  } as Response
}

describe('Twilio MMS media', () => {
  it('extracts supported image descriptors and bounds attachment count', () => {
    const params: Record<string, string> = { NumMedia: '6' }
    const types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/jpeg', 'video/mp4']
    types.forEach((type, index) => {
      params[`MediaUrl${index}`] = mediaUrl(`ME${String(index).padStart(32, '0')}`)
      params[`MediaContentType${index}`] = type
    })

    const result = parseTwilioMedia(params)

    expect(result.declaredCount).toBe(6)
    expect(result.images).toHaveLength(MAX_MMS_IMAGES)
    expect(result.rejectedCount).toBe(2)
  })

  it('normalizes the common image/jpg alias for OpenAI', () => {
    const result = parseTwilioMedia({
      NumMedia: '1',
      MediaUrl0: mediaUrl(),
      MediaContentType0: 'image/jpg',
    })

    expect(result.images[0]?.contentType).toBe('image/jpeg')
  })

  it('accepts only the expected Twilio HTTPS media path', () => {
    expect(isExpectedTwilioMediaUrl(mediaUrl(), ACCOUNT_SID, MESSAGE_SID)).toBe(true)
    expect(isExpectedTwilioMediaUrl('https://example.com/image.jpg', ACCOUNT_SID, MESSAGE_SID)).toBe(false)
    expect(isExpectedTwilioMediaUrl(mediaUrl(), 'ACother', MESSAGE_SID)).toBe(false)
    expect(isExpectedTwilioMediaUrl(mediaUrl(), ACCOUNT_SID, 'MMother')).toBe(false)
  })

  it('fetches protected media with Basic auth and produces an OpenAI data URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse([1, 2, 3]))

    const result = await fetchTwilioImages({
      media: [{ url: mediaUrl(), contentType: 'image/png' }],
      accountSid: ACCOUNT_SID,
      authToken: 'secret-token',
      messageSid: MESSAGE_SID,
      fetchImpl: fetchMock as typeof fetch,
    })

    expect(result).toEqual({
      images: [{ contentType: 'image/png', dataUrl: 'data:image/png;base64,AQID' }],
      failedCount: 0,
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({
      Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:secret-token`).toString('base64')}`,
    })
    expect(init.redirect).toBe('follow')
  })

  it('rejects unexpected URLs, response types, and oversized media', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse([1], 'text/html'))
      .mockResolvedValueOnce(imageResponse([1], 'image/jpeg', MAX_MMS_TOTAL_BYTES + 1))

    const result = await fetchTwilioImages({
      media: [
        { url: 'https://example.com/not-twilio.jpg', contentType: 'image/jpeg' },
        { url: mediaUrl('ME00000000000000000000000000000001'), contentType: 'image/jpeg' },
        { url: mediaUrl('ME00000000000000000000000000000002'), contentType: 'image/jpeg' },
      ],
      accountSid: ACCOUNT_SID,
      authToken: 'secret-token',
      messageSid: MESSAGE_SID,
      fetchImpl: fetchMock as typeof fetch,
    })

    expect(result).toEqual({ images: [], failedCount: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
