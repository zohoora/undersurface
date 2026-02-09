import { useState } from 'react'
import { updateSettings } from '../store/settings'

export function Onboarding() {
  const [apiKey, setApiKey] = useState('')

  const handleSave = () => {
    updateSettings({
      openRouterApiKey: apiKey.trim(),
      hasSeenOnboarding: true,
    })
  }

  const handleSkip = () => {
    updateSettings({ hasSeenOnboarding: true })
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#FAF8F5',
    }}>
      <div style={{
        maxWidth: 380,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}>
        <div style={{
          fontFamily: "'Spectral', serif",
          fontSize: 24,
          color: '#4A453F',
        }}>
          Welcome to UnderSurface
        </div>
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          color: '#A09A94',
          textAlign: 'center',
          lineHeight: 1.6,
        }}>
          To enable AI inner voices, enter your OpenRouter API key.
          The app works without one — AI features will stay dormant.
        </div>
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            color: '#7A9E7E',
          }}
        >
          Get an API key from OpenRouter
        </a>
        <input
          type="password"
          placeholder="sk-or-v1-..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid #D5D0CA',
            borderRadius: 6,
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            background: 'white',
            color: '#4A453F',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSave}
          disabled={!apiKey.trim()}
          style={{
            width: '100%',
            padding: '10px 20px',
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            border: '1px solid #D5D0CA',
            borderRadius: 8,
            background: apiKey.trim() ? '#4A453F' : '#E8E4DF',
            color: apiKey.trim() ? '#FAF8F5' : '#A09A94',
            cursor: apiKey.trim() ? 'pointer' : 'default',
          }}
        >
          Save & Begin
        </button>
        <button
          onClick={handleSkip}
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            color: '#A09A94',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
