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
            }
          } catch {
            // skip malformed JSON chunks
          }
        }
      }
    } finally {
      clearTimeout(timeout)
    }

    callbacks.onComplete(fullText)
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)))
  }
}

export async function analyzeEmotion(text: string): Promise<string> {
  const response = await chatCompletion([
    {
      role: 'system',
      content: `You analyze the emotional tone of diary writing. Respond with ONLY one word from this list: neutral, tender, anxious, angry, sad, joyful, contemplative, fearful, hopeful, conflicted. Nothing else.`,
    },
    {
      role: 'user',
      content: text.slice(-500),
    },
  ])
  return response.trim().toLowerCase()
}
