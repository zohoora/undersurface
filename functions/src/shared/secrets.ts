import { defineSecret } from 'firebase-functions/params'

export const openAiKey = defineSecret('OPENAI_API_KEY')
export const elevenLabsKey = defineSecret('ELEVENLABS_API_KEY')
