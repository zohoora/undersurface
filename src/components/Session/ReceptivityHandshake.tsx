import { useState } from 'react'
import { useTranslation } from '../../i18n'
import type {
  PersonalScienceCapacity,
  PersonalScienceNeed,
  PersonalScienceState,
  SessionResearchContext,
} from '../../types'

interface Props {
  initial?: SessionResearchContext
  onSave: (context: SessionResearchContext) => void
  onSkip: () => void
}

const chipStyle = (active: boolean) => ({
  border: `1px solid ${active ? 'var(--accent-warm)' : 'var(--border-subtle)'}`,
  borderRadius: 999,
  padding: '4px 8px',
  background: active ? 'var(--overlay-subtle)' : 'transparent',
  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
  fontSize: 10,
  cursor: 'pointer',
}) as const

export function ReceptivityHandshake({ initial, onSave, onSkip }: Props) {
  const tr = useTranslation()
  const [state, setState] = useState<PersonalScienceState | undefined>(initial?.state)
  const [capacity, setCapacity] = useState<PersonalScienceCapacity | undefined>(initial?.capacity)
  const [need, setNeed] = useState<PersonalScienceNeed | undefined>(initial?.need)

  const complete = Boolean(state && capacity && need)
  const save = () => {
    if (!state || !capacity || !need) return
    onSave({ state, capacity, need, capturedAt: Date.now() })
  }

  return (
    <section aria-label={tr['ps.handshake.title']} style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '11px 12px', margin: '8px 0 18px', color: 'var(--text-secondary)', font: "10px/1.4 'Inter', sans-serif" }}>
      <div style={{ color: 'var(--text-primary)', fontSize: 11, marginBottom: 3 }}>{tr['ps.handshake.title']}</div>
      <div style={{ color: 'var(--text-ghost)', marginBottom: 9 }}>{tr['ps.handshake.note']}</div>
      <HandshakeRow label={tr['ps.handshake.state']} options={[
        ['stirred', tr['ps.state.stirred']], ['flat', tr['ps.state.flat']], ['looping', tr['ps.state.looping']], ['open', tr['ps.state.open']],
      ]} value={state} onChange={value => setState(value as PersonalScienceState)} />
      <HandshakeRow label={tr['ps.handshake.time']} options={[
        ['brief', tr['ps.capacity.brief']], ['few_minutes', tr['ps.capacity.fewMinutes']], ['stay', tr['ps.capacity.stay']],
      ]} value={capacity} onChange={value => setCapacity(value as PersonalScienceCapacity)} />
      <HandshakeRow label={tr['ps.handshake.need']} options={[
        ['witness', tr['ps.need.witness']], ['settle', tr['ps.need.settle']], ['perspective', tr['ps.need.perspective']], ['action', tr['ps.need.action']],
      ]} value={need} onChange={value => setNeed(value as PersonalScienceNeed)} />
      <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
        <button type="button" disabled={!complete} onClick={save} style={{ ...chipStyle(complete), opacity: complete ? 1 : 0.45 }}>{tr['ps.handshake.use']}</button>
        <button type="button" onClick={onSkip} style={{ ...chipStyle(false), borderColor: 'transparent' }}>{tr['ps.handshake.skip']}</button>
      </div>
    </section>
  )
}

function HandshakeRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<[string, string]>
  value?: string
  onChange: (value: string) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
      <span style={{ width: 32, color: 'var(--text-ghost)' }}>{label}</span>
      {options.map(([option, labelText]) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)} style={chipStyle(value === option)}>{labelText}</button>
      ))}
    </div>
  )
}
