import { beforeEach, describe, expect, it, vi } from 'vitest'

const save = vi.fn()
const file = vi.fn(() => ({ save }))
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({ bucket: () => ({ file }) }),
}))

const { persistSmsMomentMedia } = await import('./moments')

describe('SMS field moment media', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes supported image bytes beneath the owning user prefix', async () => {
    const paths = await persistSmsMomentMedia('user-1', 'message-1', [
      { contentType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AQID' },
    ])
    expect(paths).toEqual(['field-moments/user-1/message-1/0.jpg'])
    expect(file).toHaveBeenCalledWith('field-moments/user-1/message-1/0.jpg')
    expect(save).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      resumable: false,
      metadata: expect.objectContaining({ contentType: 'image/jpeg' }),
    }))
  })

  it('refuses malformed or unsupported data URLs', async () => {
    await expect(persistSmsMomentMedia('u', 'm', [
      { contentType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,AQID' },
      { contentType: 'image/png', dataUrl: 'https://example.com/image.png' },
    ])).resolves.toEqual([])
    expect(save).not.toHaveBeenCalled()
  })
})
