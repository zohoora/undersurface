import { getSettings } from '../store/settings'
import { getAuth } from 'firebase/auth'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface StreamCallbacks {
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
}

async function getAuthToken(): Promise<string> {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')
  return user.getIdToken()
}

function getModel(): string {
  return getSettings().openRouterModel || 'google/gemini-3-flash-preview'
}

export async function chatCompletion(
  messages: Message[],
  timeoutMs: number = 10000,
  maxTokens: number = 150,
): Promise<string> {
  const token = await getAuthToken()
  const model = getModel()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.9,
        frequency_penalty: 0.4,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`API error: ${response.status}${body ? ` — ${body}` : ''}`)
    }

    const data = await response.json()
    return data.choices[0].message.content
  } finally {
    clearTimeout(timeout)
  }
}

export async function streamChatCompletion(
  messages: Message[],
  callbacks: StreamCallbacks,
  maxTokens: number = 150,
): Promise<void> {
  try {
    const token = await getAuthToken()
    const model = getModel()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    let response: Response
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.9,
          frequency_penalty: 0.4,
          stream: true,
        }),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      throw err
    }

    if (!response.ok) {
      clearTimeout(timeout)
      const body = await response.text().catch(() => '')
      throw new Error(`API error: ${response.status}${body ? ` — ${body}` : ''}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      clearTimeout(timeout)
      throw new Error('No reader available')
    }

    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    let loopDetected = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const token = parsed.choices?.[0]?.delta?.content
            if (token) {
              fullText += token
              callbacks.onToken(token)

              // Repetition loop detection: if the last 40 chars appear
              // earlier in the text, the model is stuck in a loop — abort.
              if (fullText.length > 100) {
                const tail = fullText.slice(-40)
                const searchArea = fullText.slice(0, -40)
                if (searchArea.includes(tail)) {
                  console.warn('Repetition loop detected, aborting stream')
                  loopDetected = true
                  controller.abort()
                  break
                }
              }
            }
          } catch {
            // skip malformed JSON chunks
          }
        }

        if (loopDetected) break
      }
    } finally {
      clearTimeout(timeout)
    }

    // If loop detected, trim the repeated content
    if (loopDetected && fullText.length > 100) {
      const tail = fullText.slice(-40)
      const firstOccurrence = fullText.indexOf(tail)
      if (firstOccurrence >= 0 && firstOccurrence < fullText.length - 40) {
        fullText = fullText.slice(0, firstOccurrence + tail.length).trimEnd()
      }
    }

    callbacks.onComplete(fullText)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)))
  }
}

export async function analyzeEmotionAndDistress(text: string): Promise<{ emotion: string; distressLevel: number }> {
  const response = await chatCompletion([
    {
      role: 'system',
      content: `You analyze the emotional tone and distress level of diary writing. This is a journaling app where people process difficult emotions — that is normal and healthy, not distress. This writing may be in any language. Respond with valid JSON only, no other text:
{"emotion": "<one of: neutral, tender, anxious, angry, sad, joyful, contemplative, fearful, hopeful, conflicted>", "distress": <0-3>}

Distress scale (err on the side of LOW scores — processing hard feelings is not distress):
0 = no distress — normal writing, even if exploring sadness, anger, fear, or painful memories
1 = mild distress — venting frustration, expressing worry or unease, processing grief
2 = elevated distress — writer seems genuinely overwhelmed right now (not reflecting on past overwhelm), expressing hopelessness about the future, or describing an active panic episode
3 = safety concern — explicit mention of suicidal thoughts, self-harm urges, or intent to harm others. ONLY use 3 for clear safety-relevant language, not metaphor or dark imagery`,
    },
    {
      role: 'user',
      content: text.slice(-500),
    },
  ])

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { emotion?: string; distress?: number }
      return {
        emotion: typeof parsed.emotion === 'string' ? parsed.emotion.trim().toLowerCase() : 'neutral',
        distressLevel: typeof parsed.distress === 'number' ? Math.min(3, Math.max(0, Math.round(parsed.distress))) : 0,
      }
    }
  } catch {
    // Parse failure — fall back to extracting emotion word
  }

  // Fallback: try to extract just an emotion word
  const lower = response.trim().toLowerCase()
  const validEmotions = ['neutral', 'tender', 'anxious', 'angry', 'sad', 'joyful', 'contemplative', 'fearful', 'hopeful', 'conflicted']
  const found = validEmotions.find((e) => lower.includes(e))
  return { emotion: found ?? 'neutral', distressLevel: 0 }
}
