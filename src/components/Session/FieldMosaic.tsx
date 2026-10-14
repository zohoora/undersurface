import { useEffect, useId, useState } from 'react'
import { getBlob, ref } from 'firebase/storage'
import { storage } from '../../firebase'
import { db } from '../../store/db'
import type { FieldMoment, ImmediateOutcome } from '../../types'
import { writeFieldMomentOutcome } from '../../store/interventionOutcomes'
import { loadUnreviewedFieldMoments } from '../../store/fieldMoments'
import { useTranslation } from '../../i18n'
import { CARD_FONT, cardChipStyle, cardInputStyle, cardLabelStyle, cardNoteStyle, cardQuietButtonStyle } from './cardControls'

function MomentImage({ path, alt }: { path: string; alt: string }) {
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
  return url ? <img src={url} alt={alt} style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }} /> : null
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
  const tr = useTranslation()
  const idBase = useId()

  useEffect(() => {
    let active = true
    void Promise.all([
      db.companionPreferences.get('current'),
      loadUnreviewedFieldMoments(),
    ]).then(([preferences, unreviewed]) => {
      if (!active || preferences?.fieldMosaicEnabled === false) return
      setMoments(unreviewed)
    }).catch(() => { /* the mosaic is optional; stay hidden */ })
    return () => { active = false }
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
  const rateOptions: Array<[ImmediateOutcome, string]> = [
    ['helped', tr['fieldMosaic.rate.helped']],
    ['nothing', tr['fieldMosaic.rate.nothing']],
    ['worse', tr['fieldMosaic.rate.worse']],
    ['not_wanted', tr['fieldMosaic.rate.notWanted']],
  ]
  const cursor = disabled ? 'default' : 'pointer'
  return (
    <section aria-label={tr['fieldMosaic.aria']} style={{ margin: '8px 0 24px' }}>
      <div style={{ margin: '0 0 4px', font: "600 12px 'Inter', sans-serif", textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>{tr['fieldMosaic.title']}</div>
      <div style={{ ...cardNoteStyle, marginBottom: 10 }}>{tr['fieldMosaic.subtitle']}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {moments.map(moment => (
          <article key={moment.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 12, background: 'var(--overlay-subtle)' }}>
            {moment.mediaPaths?.map(path => <MomentImage key={path} path={path} alt={tr['fieldMosaic.imageAlt']} />)}
            <div style={{ fontFamily: CARD_FONT, fontSize: 13, lineHeight: 1.5, color: 'var(--text-primary)' }}>{moment.text}</div>
            <div style={{ ...cardNoteStyle, marginTop: 4 }}>{new Date(moment.createdAt).toLocaleString()}</div>
            <label htmlFor={`${idBase}-${moment.id}-meaning`} style={{ ...cardLabelStyle, marginTop: 10, marginBottom: 4 }}>
              {tr['fieldMosaic.meaningLabel']}
            </label>
            <input id={`${idBase}-${moment.id}-meaning`} value={meanings[moment.id] ?? ''} onChange={event => setMeanings(values => ({ ...values, [moment.id]: event.target.value }))} style={cardInputStyle} />
            {moments.length > 1 && (
              <>
                <label htmlFor={`${idBase}-${moment.id}-connect`} style={{ ...cardLabelStyle, marginTop: 8, marginBottom: 4 }}>
                  {tr['fieldMosaic.connectLabel']}
                </label>
                <select id={`${idBase}-${moment.id}-connect`} value={connections[moment.id] ?? ''} onChange={event => setConnections(values => ({ ...values, [moment.id]: event.target.value }))} style={{ ...cardInputStyle, background: 'var(--surface-primary)', color: 'var(--text-secondary)' }}>
                  <option value="">{tr['fieldMosaic.noConnection']}</option>
                  {moments.filter(other => other.id !== moment.id).map(other => <option key={other.id} value={other.id}>{tr['fieldMosaic.connectWith'].replace('{text}', other.text.slice(0, 48))}</option>)}
                </select>
              </>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <button type="button" disabled={disabled} onClick={() => void resolve(moment, 'kept', true)} style={{ ...cardChipStyle(), flex: 1, color: 'var(--text-primary)', cursor }}>{tr['fieldMosaic.bringIntoTalk']}</button>
              <button type="button" disabled={disabled} onClick={() => void resolve(moment, 'kept')} style={{ ...cardChipStyle(), cursor }}>{tr['fieldMosaic.keep']}</button>
              <button type="button" disabled={disabled} onClick={() => void resolve(moment, 'dismissed')} style={{ ...cardQuietButtonStyle, cursor }}>{tr['fieldMosaic.notNow']}</button>
            </div>
            {moment.source === 'sms' && !rated[moment.id] && (
              <div role="group" aria-label={tr['fieldMosaic.smsQuestion']} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10, ...cardNoteStyle }}>
                <span style={{ flexBasis: '100%' }}>{tr['fieldMosaic.smsQuestion']}</span>
                {rateOptions.map(([value, label]) => <button key={value} type="button" disabled={disabled} onClick={() => void rate(moment, value)} style={{ ...cardChipStyle(), cursor }}>{label}</button>)}
              </div>
            )}
          </article>
        ))}
      </div>
      {moments.length > 1 && <button type="button" disabled={disabled} onClick={() => void dismissAll()} style={{ ...cardQuietButtonStyle, marginTop: 8, cursor }}>{tr['fieldMosaic.dismissAll']}</button>}
    </section>
  )
}
