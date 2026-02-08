import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSettings, updateSettings } from '../../store/settings'

interface OpenRouterModel {
  id: string
  name: string
  pricing: { prompt: string; completion: string }
}

let modelCache: OpenRouterModel[] | null = null

async function fetchModels(): Promise<OpenRouterModel[]> {
  if (modelCache) return modelCache
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) return []
  const data = await res.json()
  modelCache = (data.data || []).map((m: Record<string, unknown>) => ({
    id: m.id,
    name: m.name || m.id,
    pricing: m.pricing || { prompt: '0', completion: '0' },
  }))
  return modelCache!
}

export function ModelSelector() {
  const settings = useSettings()
  const [search, setSearch] = useState('')
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchModels().then((m) => { if (!cancelled) setModels(m) })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return models.slice(0, 20)
    const q = search.toLowerCase()
    return models.filter((m) =>
      m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    ).slice(0, 20)
  }, [search, models])

  const handleSelect = useCallback((modelId: string) => {
    updateSettings({ openRouterModel: modelId })
    setSearch('')
    setIsOpen(false)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentModelName = models.find((m) => m.id === settings.openRouterModel)?.name || settings.openRouterModel

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setIsOpen(true) }}
        onFocus={() => setIsOpen(true)}
        placeholder={currentModelName}
        style={{
          width: '100%',
          padding: '6px 8px',
          border: '1px solid #D5D0CA',
          borderRadius: 4,
          fontFamily: "'Inter', sans-serif",
          fontSize: 11,
          background: 'white',
          color: '#4A453F',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {isOpen && filtered.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          maxHeight: 200,
          overflowY: 'auto',
          background: 'white',
          border: '1px solid #D5D0CA',
          borderRadius: 4,
          marginTop: 2,
          zIndex: 100,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          {filtered.map((m) => (
            <div
              key={m.id}
              onClick={() => handleSelect(m.id)}
              style={{
                padding: '6px 8px',
                fontSize: 11,
                fontFamily: "'Inter', sans-serif",
                cursor: 'pointer',
                borderBottom: '1px solid #F0EDE8',
                color: m.id === settings.openRouterModel ? '#7A9E7E' : '#4A453F',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#FAF8F5' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'white' }}
            >
              <div style={{ fontWeight: m.id === settings.openRouterModel ? 500 : 400 }}>{m.name}</div>
              <div style={{ fontSize: 10, opacity: 0.5, marginTop: 1 }}>{m.id}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
