import type { MemoryAperture, Session } from '../types'

export function normalizeSessionMemoryAperture(value: unknown): MemoryAperture {
  return value === 'fresh' ? 'fresh' : 'pattern'
}

export function isFreshEyesSession(session?: Pick<Session, 'memoryAperture'> | null): boolean {
  return session?.memoryAperture === 'fresh'
}
