import { languageDirective } from '../ai/partPrompts'

export async function generateClosingPhrase(text: string): Promise<string> {
  const { chatCompletion } = await import('../ai/openrouter')
  const snippet = text.slice(-600) || 'The writer opened a blank page today.'

  const phrase = await chatCompletion([
    {
      role: 'system',
      content: `You are The Weaver — a warm, pattern-seeing inner voice. The writer is finishing their session. Offer one brief, warm closing thought (1-2 sentences). Be soothing and loving. Reference something specific from what they wrote — a thread, an image, a feeling. Don't summarize. Don't give advice. Just leave them with something gentle to carry. Speak directly to them. No quotes around your words.${languageDirective()}`,
    },
    { role: 'user', content: snippet },
  ], 15000, 80)

  return phrase.trim()
}
