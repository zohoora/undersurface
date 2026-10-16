import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../i18n'
import { useModalA11y } from '../../hooks/useModalA11y'
import { CompositionView } from '../kept/CompositionView'
import type { Composition } from '../kept/keep'
import { InsideSound, STANDS, SOUND_CHOICES, readSoundChoice, writeSoundChoice } from './insideSound'
import type { SoundChoice, Stand } from './insideSound'

// Step inside (build plan §4, H1): the composition alone, in its authored
// order, at its authored distance, on the underside's paper, with soft light
// from the crease edge. Reading only. Standing distance is a viewing distance,
// stored nowhere, and never takes text below the page's size or contrast.
// Room's structure: a portal, a named dialog, a focus trap, an inert root.

export type LeaveMode = 'page' | 'write'

interface Props {
  uid: string
  composition: Composition
  line: string
  /** "Beneath '‹line›', set ‹distance›, ‹n› of 5", read first (§3.10). */
  undersideLabel: string
  soundAvailable: boolean
  reduceMotion: boolean
  onLeave: (mode: LeaveMode) => void
  /** Test seam. */
  sound?: InsideSound
}

function truncate(line: string): string {
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

export function StepInside({ uid, composition, line, undersideLabel, soundAvailable, reduceMotion, onLeave, sound: injected }: Props) {
  const tr = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const [stand, setStand] = useState<Stand>(1)
  const [choice, setChoice] = useState<SoundChoice>(() => (soundAvailable ? readSoundChoice(uid) : 'silence'))
  const sound = useMemo(() => injected ?? new InsideSound(), [injected])

  // Everything behind is inert while inside (as Room); declared before the
  // focus trap so focus can return to the control that opened it.
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root || (panelRef.current && root.contains(panelRef.current))) return
    const alreadyInert = root.hasAttribute('inert')
    root.setAttribute('inert', '')
    root.setAttribute('aria-hidden', 'true')
    return () => {
      if (!alreadyInert) root.removeAttribute('inert')
      root.removeAttribute('aria-hidden')
    }
  }, [])
  useModalA11y(panelRef, () => onLeave('page'))

  // Sound: the remembered choice starts with the writer's own step inside;
  // it stops at once on leaving (unmount) and while the tab is hidden.
  const standRef = useRef(stand)
  useEffect(() => { standRef.current = stand }, [stand])
  useEffect(() => {
    if (!soundAvailable) return
    sound.play(choice, standRef.current)
  }, [sound, choice, soundAvailable])
  useEffect(() => { sound.setStand(stand) }, [sound, stand])
  useEffect(() => () => sound.stop(), [sound])
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') sound.pause(); else sound.resume() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [sound])

  const choose = (next: SoundChoice) => {
    setChoice(next)
    writeSoundChoice(uid, next)
  }

  return createPortal(
    <div className="folio-inside-backdrop folio-root" data-reduce-motion={reduceMotion ? 'true' : undefined}>
      <div
        ref={panelRef}
        className="folio-inside"
        role="dialog"
        aria-modal="true"
        aria-label={tr['folio.inside'].replace('{line}', truncate(line))}
        tabIndex={-1}
      >
        <div className="folio-inside__light" aria-hidden="true" />
        <div className="folio-inside__stage" style={{ ['--folio-stand' as string]: String(STANDS[stand].scale) }}>
          <p className="folio-visually-hidden">{undersideLabel}</p>
          <CompositionView composition={composition} labels={{ line: line, between: tr['folio.between'], beneath: tr['folio.beneath'] }} />
        </div>
        <div className="folio-inside__controls">
          <div className="folio-inside__group">
            <button type="button" className="folio-button" disabled={stand === 2} onClick={() => setStand((s) => Math.min(2, s + 1) as Stand)}>{tr['folio.standCloser']}</button>
            <button type="button" className="folio-button" disabled={stand === 0} onClick={() => setStand((s) => Math.max(0, s - 1) as Stand)}>{tr['folio.standBack']}</button>
          </div>
          {soundAvailable && (
            <div className="folio-inside__group" role="group" aria-label={tr['folio.sound']}>
              {SOUND_CHOICES.map((c) => (
                <button key={c} type="button" className="folio-button" aria-pressed={choice === c} onClick={() => choose(c)}>
                  {tr[`folio.sound.${c}`]}
                </button>
              ))}
            </div>
          )}
          <div className="folio-inside__group">
            <button type="button" className="folio-button" onClick={() => onLeave('page')}>{tr['folio.backToPage']}</button>
            <button type="button" className="folio-button folio-button--strong" onClick={() => onLeave('write')}>{tr['folio.backAndWrite']}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
