import { useEffect, useState } from 'react'
import { getBlob, ref } from 'firebase/storage'
import { storage } from '../../firebase'
import { db } from '../../store/db'
import type { FieldMoment } from '../../types'
import type { ImmediateOutcome } from '../../types'
import { writeFieldMomentOutcome } from '../../store/interventionOutcomes'

function MomentImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    void getBlob(ref(storage, path)).then(blob => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => {})
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])
  return url ? <img src={url} alt="A private field moment" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} /> : null
}

export function FieldMosaic({
  sessionId,
  disabled = false,
  onBringIntoTalk,
}: {
  sessionId: string
  disabled?: boolean
  onBringIntoTalk?: (moment: FieldMoment) => void | Promise<void>
}) {
  const [moments, setMoments] = useState<FieldMoment[]>([])
  const [meanings, setMeanings] = useState<Record<string, string>>({})
  const [connections, setConnections] = useState<Record<string, string>>({})
  const [rated, setRated] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void Promise.all([
      db.companionPreferences.get('current'),
      db.fieldMoments.orderBy('createdAt').reverse().limit(6).toArray(),
    ]).then(([preferences, recent]) => {
      if (preferences?.fieldMosaicEnabled === false) return
      setMoments(recent.filter(moment => moment.status === 'unreviewed'))
    })
  }, [sessionId])

  const resolve = async (moment: FieldMoment, status: 'kept' | 'dismissed', bringIntoTalk = false) => {
    const meaning = meanings[moment.id]?.trim() || null
    await db.fieldMoments.update(moment.id, {
      status,
      userMeaning: meaning,
      reviewedInSessionId: sessionId,
      connectedTo: status === 'kept' ? connections[moment.id] || null : null,
    })
    setMoments(list => list.filter(item => item.id !== moment.id))
    if (bringIntoTalk) await onBringIntoTalk?.({ ...moment, status, userMeaning: meaning })
  }

  const dismissAll = async () => {
    const current = moments
    setMoments([])
    await Promise.all(current.map(moment => db.fieldMoments.update(moment.id, {
      status: 'dismissed', reviewedInSessionId: sessionId,
    })))
  }

  const rate = async (moment: FieldMoment, immediate: ImmediateOutcome) => {
    setRated(values => ({ ...values, [moment.id]: true }))
    await writeFieldMomentOutcome(moment, immediate)
  }

  if (moments.length === 0) return null
  return (
    <section aria-label="Field mosaic" style={{ margin: '8px 0 24px' }}>
      <div style={{ font: "600 11px 'Inter', sans-serif", textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4 }}>From the field</div>
      <div style={{ font: "11px/1.45 'Inter', sans-serif", color: 'var(--text-ghost)', marginBottom: 10 }}>Small moments you sent between sessions. You decide what connects.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {moments.map(moment => (
          <article key={moment.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 10, background: 'var(--overlay-subtle)' }}>
            {moment.mediaPaths?.map(path => <MomentImage key={path} path={path} />)}
            <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)' }}>{moment.text}</div>
            <div style={{ fontSize: 9, color: 'var(--text-ghost)', marginTop: 5 }}>{new Date(moment.createdAt).toLocaleString()}</div>
            <input value={meanings[moment.id] ?? ''} onChange={event => setMeanings(values => ({ ...values, [moment.id]: event.target.value }))} placeholder="What does this mean to you? (optional)" style={{ width: '100%', marginTop: 8, border: '1px solid var(--border-light)', borderRadius: 5, background: 'transparent', color: 'var(--text-primary)', padding: '5px 7px', fontSize: 10 }} />
            {moments.length > 1 && (
              <select aria-label="Connect this moment" value={connections[moment.id] ?? ''} onChange={event => setConnections(values => ({ ...values, [moment.id]: event.target.value }))} style={{ width: '100%', marginTop: 6, border: '1px solid var(--border-light)', borderRadius: 5, background: 'var(--surface-primary)', color: 'var(--text-secondary)', padding: '4px 6px', fontSize: 9 }}>
                <option value="">No connection yet</option>
                {moments.filter(other => other.id !== moment.id).map(other => <option key={other.id} value={other.id}>Connect with: {other.text.slice(0, 48)}</option>)}
              </select>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button disabled={disabled} onClick={() => void resolve(moment, 'kept', true)} style={{ flex: 1, border: '1px solid var(--border-subtle)', borderRadius: 999, padding: '4px 7px', background: 'transparent', color: 'var(--text-primary)', fontSize: 10, cursor: disabled ? 'default' : 'pointer' }}>bring into Talk</button>
              <button disabled={disabled} onClick={() => void resolve(moment, 'kept')} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '4px 7px', background: 'transparent', color: 'var(--text-secondary)', fontSize: 10, cursor: disabled ? 'default' : 'pointer' }}>keep</button>
              <button disabled={disabled} onClick={() => void resolve(moment, 'dismissed')} style={{ border: 0, background: 'transparent', color: 'var(--text-ghost)', fontSize: 10, cursor: disabled ? 'default' : 'pointer' }}>not now</button>
            </div>
            {moment.source === 'sms' && !rated[moment.id] && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginTop: 8, color: 'var(--text-ghost)', fontSize: 8 }}>
                <span>did the SMS exchange help?</span>
                {([['helped', 'yes'], ['nothing', 'no'], ['worse', 'worse'], ['not_wanted', 'unwanted']] as Array<[ImmediateOutcome, string]>).map(([value, label]) => <button key={value} disabled={disabled} onClick={() => void rate(moment, value)} style={{ border: '1px solid var(--border-light)', borderRadius: 999, padding: '2px 5px', background: 'transparent', color: 'var(--text-secondary)', fontSize: 8, cursor: disabled ? 'default' : 'pointer' }}>{label}</button>)}
              </div>
            )}
          </article>
        ))}
      </div>
      {moments.length > 1 && <button disabled={disabled} onClick={() => void dismissAll()} style={{ marginTop: 8, border: 0, background: 'transparent', color: 'var(--text-ghost)', fontSize: 9, cursor: disabled ? 'default' : 'pointer' }}>none of these matter right now</button>}
    </section>
  )
}
