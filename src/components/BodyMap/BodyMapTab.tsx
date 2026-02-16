import { useState, useEffect } from 'react'
import { db } from '../../store/db'
import { computeHomunculusState, DORMANT_THRESHOLD, BODY_REGIONS } from '../../engine/bodyMapEngine'
import { HomunculusSVG } from './HomunculusSVG'
import { RegionDetail } from './RegionDetail'
import { useTranslation } from '../../i18n'
import type { BodyRegion, HomunculusState } from '../../types'

function emptyState(): HomunculusState {
  const state = {} as HomunculusState
  for (const region of BODY_REGIONS) {
    state[region] = {
      signalCount: 0,
      dominantEmotions: [],
      sizeFactor: 1.0,
      fillColor: '#D4CFC8',
      quotes: [],
    }
  }
  return state
}

export function BodyMapTab() {
  const [state, setState] = useState<HomunculusState>(emptyState)
  const [selectedRegion, setSelectedRegion] = useState<BodyRegion | null>(null)
  const [totalSignals, setTotalSignals] = useState(0)
  const t = useTranslation()

  useEffect(() => {
    let cancelled = false

    async function load() {
      const memories = await db.memories.where('partId').equals('_somatic').toArray()
      if (cancelled) return

      const computed = computeHomunculusState(memories)
      setState(computed)
      setTotalSignals(memories.length)
    }

    load()
    return () => { cancelled = true }
  }, [])

  const isDormant = totalSignals < DORMANT_THRESHOLD

  return (
    <div
      style={{ padding: '0 4px' }}
      onClick={() => setSelectedRegion(null)}
    >
      {isDormant ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          paddingTop: 24,
        }}>
          <HomunculusSVG
            state={emptyState()}
            onRegionTap={() => {}}
            selectedRegion={null}
          />
          <p style={{
            fontSize: 12,
            color: 'var(--text-ghost)',
            fontStyle: 'italic',
            textAlign: 'center',
            letterSpacing: '0.02em',
          }}>
            {t['bodyMap.dormant']}
          </p>
        </div>
      ) : (
        <>
          <HomunculusSVG
            state={state}
            onRegionTap={(region) => setSelectedRegion(
              selectedRegion === region ? null : region
            )}
            selectedRegion={selectedRegion}
          />
          {selectedRegion && (
            <RegionDetail
              region={selectedRegion}
              state={state[selectedRegion]}
              onClose={() => setSelectedRegion(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
