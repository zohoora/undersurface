// Curated preset prompts. Labels are short (UI display); the long-form
// prompt is what we send to ElevenLabs — engineered for quality based on
// listening tests. Users can tap a preset to fill the textarea, then edit
// before generating.

export interface SoundscapePreset {
  id: string
  // Translation key suffix for `relax.settings.audio.preset.{id}`
  i18nKey: string
  // Long-form prompt sent to the provider. Includes acoustic hints
  // (sheltered, distant, gentle) that meaningfully improve output.
  prompt: string
}

export const SOUNDSCAPE_PRESETS: readonly SoundscapePreset[] = [
  {
    id: 'rain',
    i18nKey: 'relax.settings.audio.preset.rain',
    prompt: 'steady rain on a tin roof, gentle, no thunder, indoor sheltered acoustic, calm, 30 seconds',
  },
  {
    id: 'forest',
    i18nKey: 'relax.settings.audio.preset.forest',
    prompt: 'forest stream at dusk, gentle running water, distant birdsong, leaves rustling, peaceful',
  },
  {
    id: 'thunder',
    i18nKey: 'relax.settings.audio.preset.thunder',
    prompt: 'distant thunder, soft wind, no rain, slow rolling thunder, atmospheric, sparse',
  },
  {
    id: 'cave',
    i18nKey: 'relax.settings.audio.preset.cave',
    prompt: 'ocean cave with seabirds, gentle waves lapping, hollow reverb, distant gulls, vast',
  },
] as const
