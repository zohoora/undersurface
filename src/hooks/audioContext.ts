// Single helper for AudioContext construction with the WebKit prefix
// fallback. Returns null on browsers that lack Web Audio (rare today;
// ancient Android WebViews are the typical miss).

interface WebKitWindow {
  webkitAudioContext?: typeof AudioContext
}

export function createAudioContext(): AudioContext | null {
  const Ctx = window.AudioContext ?? (window as WebKitWindow).webkitAudioContext
  return Ctx ? new Ctx() : null
}
