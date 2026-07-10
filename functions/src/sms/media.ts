import { Buffer } from 'node:buffer'

export const MAX_MMS_IMAGES = 4
export const MAX_MMS_TOTAL_BYTES = 5 * 1024 * 1024

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export interface SmsMediaDescriptor {
  url: string
  contentType: string
}

export interface SmsImageInput {
  dataUrl: string
  contentType: string
}

export interface ParsedTwilioMedia {
  declaredCount: number
  images: SmsMediaDescriptor[]
  rejectedCount: number
}

export interface FetchedTwilioImages {
  images: SmsImageInput[]
  failedCount: number
}

type FetchLike = typeof fetch

function normalizeContentType(value: string): string {
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized
}

export function isSupportedSmsImageType(value: string): boolean {
  return SUPPORTED_IMAGE_TYPES.has(normalizeContentType(value))
}

export function parseTwilioMedia(params: Record<string, string>): ParsedTwilioMedia {
  const parsedCount = Number.parseInt(params.NumMedia ?? '0', 10)
  const declaredCount = Number.isFinite(parsedCount) && parsedCount > 0
    ? Math.min(parsedCount, 10)
    : 0
  const images: SmsMediaDescriptor[] = []
  let rejectedCount = 0

  for (let index = 0; index < declaredCount; index++) {
    const url = params[`MediaUrl${index}`] ?? ''
    const contentType = normalizeContentType(params[`MediaContentType${index}`] ?? '')
    if (!url || !isSupportedSmsImageType(contentType) || images.length >= MAX_MMS_IMAGES) {
      rejectedCount += 1
      continue
    }
    images.push({ url, contentType })
  }

  return { declaredCount, images, rejectedCount }
}

export function isExpectedTwilioMediaUrl(
  rawUrl: string,
  accountSid: string,
  messageSid: string,
): boolean {
  try {
    const url = new URL(rawUrl)
    const expectedPrefix = `/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/`
    return url.protocol === 'https:'
      && url.hostname === 'api.twilio.com'
      && url.pathname.startsWith(expectedPrefix)
  } catch {
    return false
  }
}

export async function fetchTwilioImages(opts: {
  media: SmsMediaDescriptor[]
  accountSid: string
  authToken: string
  messageSid: string
  fetchImpl?: FetchLike
}): Promise<FetchedTwilioImages> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const images: SmsImageInput[] = []
  let failedCount = 0
  let totalBytes = 0
  const authorization = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64')}`

  for (const item of opts.media.slice(0, MAX_MMS_IMAGES)) {
    if (!isExpectedTwilioMediaUrl(item.url, opts.accountSid, opts.messageSid)) {
      failedCount += 1
      continue
    }

    try {
      const response = await fetchImpl(item.url, {
        method: 'GET',
        headers: { Authorization: authorization },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        failedCount += 1
        continue
      }

      const contentType = normalizeContentType(response.headers.get('content-type') ?? item.contentType)
      const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
      if (
        !isSupportedSmsImageType(contentType)
        || (Number.isFinite(contentLength) && contentLength > MAX_MMS_TOTAL_BYTES - totalBytes)
      ) {
        failedCount += 1
        continue
      }

      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length === 0 || totalBytes + bytes.length > MAX_MMS_TOTAL_BYTES) {
        failedCount += 1
        continue
      }
      totalBytes += bytes.length
      images.push({
        contentType,
        dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
      })
    } catch {
      failedCount += 1
    }
  }

  return { images, failedCount }
}
