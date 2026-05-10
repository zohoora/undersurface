// Curated preset prompts. The label comes from i18n at
// `relax.settings.audio.preset.{id}`; the long-form prompt sent to
// ElevenLabs includes acoustic hints (sheltered, distant, gentle) that
// meaningfully improve output. Users can tap a preset to fill the
// textarea, then edit before generating.

export interface SoundscapePreset {
  id: 'rain' | 'forest' | 'thunder' | 'cave'
  prompt: string
}

export const SOUNDSCAPE_PRESETS: readonly SoundscapePreset[] = [
  { id: 'rain',    prompt: 'steady rain on a tin roof, gentle, no thunder, indoor sheltered acoustic, calm, 30 seconds' },
  { id: 'forest',  prompt: 'forest stream at dusk, gentle running water, distant birdsong, leaves rustling, peaceful' },
  { id: 'thunder', prompt: 'distant thunder, soft wind, no rain, slow rolling thunder, atmospheric, sparse' },
  { id: 'cave',    prompt: 'ocean cave with seabirds, gentle waves lapping, hollow reverb, distant gulls, vast' },
] as const
