import { useSyncExternalStore } from 'react'
import { subscribeGrounding, isGroundingActive } from '../store/groundingState'

// Re-export pure functions for backwards compatibility
export { activateGrounding, deactivateGrounding, isGroundingActive } from '../store/groundingState'

export function useGroundingMode(): boolean {
  return useSyncExternalStore(subscribeGrounding, isGroundingActive)
}
