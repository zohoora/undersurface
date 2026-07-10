import { Buffer } from 'node:buffer'
import { getStorage } from 'firebase-admin/storage'
import type { SmsImageInput } from './media.js'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export async function persistSmsMomentMedia(
  uid: string,
  momentId: string,
  images: SmsImageInput[],
): Promise<string[]> {
  const bucket = getStorage().bucket()
  const paths: string[] = []
  for (let index = 0; index < images.length; index++) {
    const image = images[index]
    const match = /^data:[^;]+;base64,(.+)$/s.exec(image.dataUrl)
    const extension = EXTENSIONS[image.contentType]
    if (!match || !extension) continue
    const path = `field-moments/${uid}/${momentId}/${index}.${extension}`
    await bucket.file(path).save(Buffer.from(match[1], 'base64'), {
      resumable: false,
      metadata: {
        contentType: image.contentType,
        cacheControl: 'private, max-age=3600',
      },
    })
    paths.push(path)
  }
  return paths
}
