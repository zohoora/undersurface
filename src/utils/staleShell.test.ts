import { describe, expect, it, vi } from 'vitest'
import { installStaleShellReload, shouldReloadForNewBuild, TAKEOVER_RELOAD_WINDOW_MS, type TakeoverContext } from './staleShell'

function fakeContainer(controller: object | null) {
  const container = new EventTarget() as EventTarget & { controller: object | null }
  container.controller = controller
  return container
}

function setup(controller: object | null, decide = vi.fn((ctx: TakeoverContext) => { void ctx; return true })) {
  const container = fakeContainer(controller)
  const target = new EventTarget()
  const reload = vi.fn(() => true)
  let grounding = false
  let clock = 1_000
  const remove = installStaleShellReload({
    container: container as unknown as ServiceWorkerContainer,
    target,
    now: () => clock,
    grounding: () => grounding,
    decide,
    reload,
  })
  return {
    container,
    target,
    reload,
    decide,
    remove,
    takeover: () => container.dispatchEvent(new Event('controllerchange')),
    setGrounding: (value: boolean) => { grounding = value },
    advance: (ms: number) => { clock += ms },
  }
}

describe('installStaleShellReload', () => {
  it('asks the policy at the takeover and reloads when it agrees', () => {
    const s = setup({})
    s.advance(2_000)
    s.takeover()
    expect(s.decide).toHaveBeenCalledWith({ hadController: true, interacted: false, grounding: false, sinceLoadMs: 3_000 })
    expect(s.reload).toHaveBeenCalledWith('sw-takeover')
  })

  it('does not reload when the policy says no', () => {
    const s = setup({}, vi.fn(() => false))
    s.takeover()
    expect(s.reload).not.toHaveBeenCalled()
  })

  it('records whether a worker served the page when it started', () => {
    const s = setup(null)
    s.container.controller = {}
    s.takeover()
    expect(s.decide.mock.calls[0][0].hadController).toBe(false)
  })

  it.each(['pointerdown', 'keydown'])('counts a %s as the writer starting', (type) => {
    const s = setup({})
    s.target.dispatchEvent(new Event(type))
    s.takeover()
    expect(s.decide.mock.calls[0][0].interacted).toBe(true)
  })

  it('reads grounding at the moment of the takeover', () => {
    const s = setup({})
    s.setGrounding(true)
    s.takeover()
    expect(s.decide.mock.calls[0][0].grounding).toBe(true)
  })

  it('stops listening once removed', () => {
    const s = setup({})
    s.remove()
    s.target.dispatchEvent(new Event('keydown'))
    s.takeover()
    expect(s.decide).not.toHaveBeenCalled()
  })
})

describe('shouldReloadForNewBuild', () => {
  const fresh: TakeoverContext = { hadController: true, interacted: false, grounding: false, sinceLoadMs: 2_000 }

  it('reloads an untouched page that booted from the old worker', () => {
    expect(shouldReloadForNewBuild(fresh)).toBe(true)
  })

  it('never reloads a page loaded from the network (first install, hard reload)', () => {
    expect(shouldReloadForNewBuild({ ...fresh, hadController: false })).toBe(false)
  })

  it('never reloads under the writer once they have started', () => {
    expect(shouldReloadForNewBuild({ ...fresh, interacted: true })).toBe(false)
  })

  it('never reloads while grounding is active', () => {
    expect(shouldReloadForNewBuild({ ...fresh, grounding: true })).toBe(false)
  })

  it('leaves a page alone once startup is over, even untouched', () => {
    expect(shouldReloadForNewBuild({ ...fresh, sinceLoadMs: TAKEOVER_RELOAD_WINDOW_MS - 1 })).toBe(true)
    expect(shouldReloadForNewBuild({ ...fresh, sinceLoadMs: TAKEOVER_RELOAD_WINDOW_MS })).toBe(false)
  })
})
