import { useState, useEffect } from 'react'
import { adminFetch } from './adminApi'
import type { ContactMessage } from './adminTypes'

export function AdminMessages() {
  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminFetch<{ messages: ContactMessage[] }>('getContactMessages')
      .then((data) => setMessages(data.messages))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ color: '#A09A94', fontSize: 13 }}>Loading messages...</div>
  if (error) return <div style={{ color: '#C4705A', fontSize: 13 }}>Error: {error}</div>
  if (messages.length === 0) return <div style={{ color: '#A09A94', fontSize: 13 }}>No messages yet.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: '#A09A94' }}>
        {messages.length} message{messages.length !== 1 ? 's' : ''}
      </div>
      {messages.map((msg) => (
        <div
          key={msg.id}
          style={{
            background: '#FFFFFF',
            border: '1px solid #E8E4DF',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#2D2B29' }}>
              {msg.displayName || msg.email || 'Unknown user'}
            </div>
            <div style={{ fontSize: 11, color: '#A09A94' }}>
              {new Date(msg.createdAt).toLocaleString()}
            </div>
          </div>
          {msg.displayName && msg.email && (
            <div style={{ fontSize: 11, color: '#A09A94', marginBottom: 8 }}>
              {msg.email}
            </div>
          )}
          <div style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: '#2D2B29',
            whiteSpace: 'pre-wrap',
          }}>
            {msg.message}
          </div>
        </div>
      ))}
    </div>
  )
}
