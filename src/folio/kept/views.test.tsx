import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FolioTrace, FolioTraceEntry } from '../../types/folio'
import type { Kept } from './useKept'

// The Kept views (draft 4 §3.7, §3.8; Phase 2 acceptance): the floor has no
// counts; Waiting holds due traces under Recent, each with Open; Add has a
// 10-second undo; Delete says what it deletes; the slip offers its actions.

vi.mock('../../i18n', () => ({
  useTranslation: () => new Proxy({}, { get: (_, key: string) => (key.includes('{') ? key : `${key}{date}`) }),
  getLanguageCode: () => 'en',
}))

const entriesByTrace = new Map<string, (e: FolioTraceEntry[]) => void>()
const store = vi.hoisted(() => ({
  addEntry: vi.fn(async () => {}),
  deleteEntry: vi.fn(async () => {}),
  deleteTrace: vi.fn(async () => {}),
}))
vi.mock('./traceStore', () => ({
  ...store,
  subscribeEntries: (_uid: string, id: string, cb: (e: FolioTraceEntry[]) => void) => { entriesByTrace.set(id, cb); cb([]); return () => entriesByTrace.delete(id) },
}))
vi.mock('../store', () => ({ pageExists: vi.fn(async () => true) }))

const { KeptView } = await import('./KeptView')
const { TraceView } = await import('./TraceView')
const { ComeBackSlip, ReturnSlip } = await import('./ComeBackSlip')

const COMPOSITION = JSON.stringify({ v: 1, line: [{ type: 'text', text: 'It was nice to see everyone.' }], gap: 1, between: null, beneath: [{ type: 'paragraph', content: [{ type: 'text', text: 'I felt absent.' }] }] })
const trace = (id: string, extra: Partial<FolioTrace> = {}): FolioTrace => ({
  id, keptAt: Date.parse('2026-10-14T12:00:00Z'), source: { pageId: 'page1', foldId: 'f1', revId: null }, surface: `Line ${id}.`, gap: 1,
  composition: COMPOSITION, author: 'writer', groundedNearKeep: false, safety: { checked: [] }, schemaVersion: 2, ...extra,
})

function keptWith(traces: FolioTrace[], extra: Partial<Kept> = {}): Kept {
  return {
    traces, loaded: true, tz: 'UTC', recent: false, slip: null, waiting: [],
    keep: vi.fn(), keepCorrection: vi.fn(), undoKeep: vi.fn(), setComeBack: vi.fn(() => true), clearComeBack: vi.fn(), notNow: vi.fn(),
    update: vi.fn(async () => {}), safety: { sweep: vi.fn(), checkNew: vi.fn() } as never,
    ...extra,
  }
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

describe('the floor', () => {
  it('lists traces newest first, with versions together, and shows no counts', () => {
    const traces = [trace('a', { keptAt: 1 }), trace('b', { keptAt: 3 }), trace('a2', { keptAt: 5, previousTraceId: 'a', title: 'the dinner' })]
    const { container } = render(<KeptView uid="u" kept={keptWith(traces)} onOpen={() => {}} />)
    const names = [...container.querySelectorAll('.folio-floor__name')].map((n) => n.textContent)
    expect(names).toEqual(['the dinner', 'Line a.', 'Line b.'])
    // No digits anywhere except inside dates.
    const text = [...container.querySelectorAll('.folio-floor__name, h1, h2, .folio-floor__promise')].map((n) => n.textContent).join(' ')
    expect(text).not.toMatch(/\d/)
  })

  it('Waiting holds due come-backs under Recent, each with Open', () => {
    const due = trace('w', { comeBackAt: 1 })
    const kept = keptWith([due], { recent: true, waiting: [due] })
    const onOpen = vi.fn()
    render(<KeptView uid="u" kept={kept} onOpen={onOpen} />)
    expect(screen.getByRole('heading', { name: 'folio.comeBack.waiting{date}' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'folio.open{date}' }))
    expect(kept.clearComeBack).toHaveBeenCalledWith('w')
    expect(onOpen).toHaveBeenCalledWith('w')
  })

  it('opening the floor sweeps every trace\'s unchecked units', () => {
    const kept = keptWith([trace('a'), trace('b')])
    render(<KeptView uid="u" kept={kept} onOpen={() => {}} />)
    expect(kept.safety.sweep).toHaveBeenCalledTimes(2)
  })
})

describe('a trace', () => {
  const props = (kept: Kept, t: FolioTrace | null) => ({ uid: 'u', trace: t, kept, switches: { between: true, distance: true, liftToday: true, ask: true, stepInside: true, stepInsideSound: true, returnOn: true, involvement: true }, onNavigate: vi.fn(), onAnnounce: vi.fn(), onLiftToday: vi.fn() })

  it('shows the composition read-only and sweeps its units once', () => {
    const t = trace('t1')
    const kept = keptWith([t])
    const { container } = render(<TraceView {...props(kept, t)} />)
    expect(container.querySelector('.folio-composition__beneath')?.textContent).toBe('I felt absent.')
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
    expect(kept.safety.sweep).toHaveBeenCalledTimes(1)
  })

  it('Add writes a dated entry, checks it at once, and Undo deletes it within 10 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const t = trace('t1')
    const kept = keptWith([t])
    render(<TraceView {...props(kept, t)} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I think I was waiting.' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'folio.add{date}' }).find((b) => (b as HTMLButtonElement).type === 'submit') as HTMLElement)
    expect(store.addEntry).toHaveBeenCalledTimes(1)
    const entry = (store.addEntry.mock.calls[0] as unknown[])[2] as FolioTraceEntry
    expect(entry).toMatchObject({ text: 'I think I was waiting.', author: 'writer' })
    expect(kept.safety.checkNew).toHaveBeenCalledWith(t, [entry], [`t1:e:${entry.id}`])
    fireEvent.click(screen.getByRole('button', { name: 'folio.undo{date}' }))
    expect(store.deleteEntry).toHaveBeenCalledWith('u', 't1', entry.id)

    // A second Add: after 10 seconds the undo is gone.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Another.' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'folio.add{date}' }).find((b) => (b as HTMLButtonElement).type === 'submit') as HTMLElement)
    expect(screen.queryByRole('button', { name: 'folio.undo{date}' })).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(10_001) })
    expect(screen.queryByRole('button', { name: 'folio.undo{date}' })).toBeNull()
  })

  it('Delete asks first, says what it deletes, then deletes the trace', () => {
    const t = trace('t1')
    const p = props(keptWith([t]), t)
    render(<TraceView {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /folio\.menu/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'folio.delete{date}' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('folio.deleteTrace.body')
    expect(store.deleteTrace).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'folio.delete{date}' }).at(-1) as HTMLElement)
    expect(store.deleteTrace).toHaveBeenCalledWith('u', 't1')
    expect(p.onNavigate).toHaveBeenCalledWith('/folio/kept', { replace: true })
  })

  it('Lift into today\'s page is offered only with its switch on', () => {
    const t = trace('t1')
    const p = props(keptWith([t]), t)
    const { unmount } = render(<TraceView {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /folio\.menu/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'folio.liftToday{date}' }))
    expect(p.onLiftToday).toHaveBeenCalledWith(t)
    unmount()
    render(<TraceView {...p} switches={{ ...p.switches, liftToday: false }} />)
    fireEvent.click(screen.getByRole('button', { name: /folio\.menu/ }))
    expect(screen.queryByRole('menuitem', { name: 'folio.liftToday{date}' })).toBeNull()
  })
})

describe('the come-back slip', () => {
  it('quotes the day the writer asked, and offers Open, Not now and Don\'t bring this back', () => {
    const t = trace('s', { comeBackAt: 2, comeBackSetAt: Date.parse('2026-10-14T12:00:00Z') })
    const h = { onOpen: vi.fn(), onNotNow: vi.fn(), onClear: vi.fn(), onLiftToday: vi.fn() }
    render(<ComeBackSlip trace={t} tz="UTC" liftToday={false} {...h} />)
    expect(screen.getByText(/folio\.comeBack\.slip/).textContent).toContain('Oct 14')
    fireEvent.click(screen.getByRole('button', { name: 'folio.open{date}' }))
    fireEvent.click(screen.getByRole('button', { name: 'folio.notNow{date}' }))
    fireEvent.click(screen.getByRole('button', { name: 'folio.comeBack.clear{date}' }))
    expect([h.onOpen, h.onNotNow, h.onClear].every((f) => f.mock.calls.length === 1)).toBe(true)
    expect(screen.queryByRole('button', { name: 'folio.liftToday{date}' })).toBeNull()
  })
})

describe('opening a trace that was just created', () => {
  const props = (kept: Kept, t: FolioTrace | null, onNavigate = vi.fn()) => ({ uid: 'u', trace: t, kept, switches: { between: true, distance: true, liftToday: true, ask: true, stepInside: true, stepInsideSound: true, returnOn: true, involvement: true }, onNavigate, onAnnounce: vi.fn(), onLiftToday: vi.fn() })

  it('waits for the listener instead of bouncing to the floor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onNavigate = vi.fn()
    const t = trace('new1')
    const { rerender } = render(<TraceView {...props(keptWith([]), null, onNavigate)} />)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(onNavigate).not.toHaveBeenCalled()
    rerender(<TraceView {...props(keptWith([t]), t, onNavigate)} />)
    expect(screen.getByRole('heading', { name: 'Line new1.' })).toBeTruthy()
    // Deleted later (here or on another device): back to the floor at once.
    rerender(<TraceView {...props(keptWith([]), null, onNavigate)} />)
    expect(onNavigate).toHaveBeenCalledWith('/folio/kept', { replace: true })
  })

  it('a trace that never arrives goes back to the floor after the grace', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onNavigate = vi.fn()
    render(<TraceView {...props(keptWith([]), null, onNavigate)} />)
    await act(async () => { vi.advanceTimersByTime(4_001) })
    expect(onNavigate).toHaveBeenCalledWith('/folio/kept', { replace: true })
  })
})

describe('Return (H3)', () => {
  it('the slip names when it was kept, never that the app thought of the writer, and offers its three actions', () => {
    const t = trace('r1', { returnEligible: true })
    const h = { onOpen: vi.fn(), onNotNow: vi.fn(), onOff: vi.fn() }
    render(<ReturnSlip trace={t} tz="UTC" {...h} />)
    expect(screen.getByText(/folio\.return\.slip/).textContent).toContain('Oct 14')
    fireEvent.click(screen.getByRole('button', { name: 'folio.open{date}' }))
    fireEvent.click(screen.getByRole('button', { name: 'folio.notNow{date}' }))
    fireEvent.click(screen.getByRole('button', { name: 'folio.return.off{date}' }))
    expect([h.onOpen, h.onNotNow, h.onOff].every((f) => f.mock.calls.length === 1)).toBe(true)
  })

  it('a trace\'s own switch shows only while the setting is on, and writes returnEligible', () => {
    const t = trace('t1')
    const kept = keptWith([t])
    const props = { uid: 'u', trace: t, kept, switches: { between: true, distance: true, liftToday: true, ask: true, stepInside: true, stepInsideSound: true, returnOn: true, involvement: true }, onNavigate: vi.fn(), onAnnounce: vi.fn(), onLiftToday: vi.fn() }
    const { unmount } = render(<TraceView {...props} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    unmount()
    render(<TraceView {...props} returnSetting />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'folio.return.trace{date}' }))
    expect(kept.update).toHaveBeenCalledWith('t1', { returnEligible: true })
  })
})

