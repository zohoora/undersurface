// Temporary English fallback for the newly introduced conductor controls.
// Keeping the complete key set in every locale prevents raw-key UI while
// native translations are prepared.
export const conductorFallback = {
  'conductor.offer.journal': 'A short stretch of private writing may fit better than another reply. [Open Journal, then return here when you want](#switch:journal-arc).',
  'conductor.offer.speak': 'It may help to hear yourself say this instead of finding perfect words. [Open Speak, then return here when you want](#switch:speak-arc).',
  'conductor.offer.relax': 'Your body may need settling more than another analysis. [Open Relax for a guided pause, then return here if you want](#switch:relax-arc).',
  'conductor.offer.drift': 'A brief left-right noticing practice may fit this moment. [Open Drift for about two minutes, then return here](#switch:drift-arc).',
  'conductor.offer.decline': 'Not now',
  'conductor.offer.declined': 'We will stay here.',
  'conductor.return.journal': 'You are back from Journal. Continue here only if something wants words.',
  'conductor.return.speak': 'You are back from Speak. Take a moment before deciding whether anything else needs saying.',
  'conductor.return.relax': 'You are back from Relax. Let the settling have a little room.',
  'conductor.return.drift': 'You are back from Drift. Let the shift have a little room.',
} as const
