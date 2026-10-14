// DOM manipulation errors from browser extensions / Chrome Translate mutate
// the tree outside React's control. They are not real app errors, so error
// boundaries let rendering continue instead of showing a failure screen.
export function isDOMManipulationError(error: Error): boolean {
  const msg = error.message || ''
  return msg.includes('removeChild') || msg.includes('insertBefore') || msg.includes('nextSibling')
}
