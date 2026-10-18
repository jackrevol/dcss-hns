// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeStorage } from '../test/fake-storage'
import { FakeWS } from '../test/fake-ws'
import type { ServerMsg } from '../ws/types'
import { KNOWN_SERVERS } from '../servers'

vi.stubGlobal('localStorage', fakeStorage())

const { listenOnce, buildLoginView } = await import('./login')
const { disposeView } = await import('./view-dispose')

type Handler = (msg: ServerMsg) => void

// The server pushes the lobby snapshot on socket open, before
// login_success; listenOnce holds it for whichever view logging in mounts.
describe('listenOnce (password login hand-over)', () => {
  it('replays the pre-login snapshot, in order, into the view the login mounted', () => {
    const conn: { onMessage: Handler } = { onMessage: () => {} }
    const lobby: string[] = []
    const lobbyHandler: Handler = (m) => lobby.push(m.msg)
    listenOnce(conn, (m) => { if (m.msg === 'login_success') conn.onMessage = lobbyHandler })
    conn.onMessage({ msg: 'lobby_clear' })
    conn.onMessage({ msg: 'lobby_complete' })
    expect(lobby).toEqual([])
    conn.onMessage({ msg: 'login_success', username: 'tester' })
    expect(lobby).toEqual(['lobby_clear', 'lobby_complete'])
    // Later messages go straight to the lobby, not through the one-shot.
    conn.onMessage({ msg: 'lobby_clear' })
    expect(lobby).toEqual(['lobby_clear', 'lobby_complete', 'lobby_clear'])
    expect(conn.onMessage).toBe(lobbyHandler)
  })

  it('a login_fail that mounts nothing restores the previous handler and hands it the snapshot', () => {
    const before: string[] = []
    const prev: Handler = (m) => before.push(m.msg)
    const conn: { onMessage: Handler } = { onMessage: prev }
    const outcomes: string[] = []
    listenOnce(conn, (m) => outcomes.push(m.msg))
    conn.onMessage({ msg: 'lobby_complete' })
    conn.onMessage({ msg: 'login_fail' })
    expect(outcomes).toEqual(['login_fail'])
    expect(conn.onMessage).toBe(prev)
    expect(before).toEqual(['lobby_complete'])
  })
})

// The sign-in form lives only in a body-mounted sheet; "Add account" opens
// it, and an involuntary sign-out opens it on mount.
describe('sign-in sheet', () => {
  const CAO = 'wss://crawl.akrasiac.org:8443/socket'
  // The focus policy branches on (pointer: coarse); stubbed per test.
  let coarse = false
  beforeEach(() => {
    coarse = false
    FakeWS.instances = []
    vi.stubGlobal('WebSocket', FakeWS)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q.includes('coarse') }))
  })
  let logins: string[] = []
  const mount = (notice?: string, prefill?: { wsUrl: string; username: string }): HTMLElement => {
    document.body.replaceChildren()
    logins = []
    const view = buildLoginView((r) => logins.push(r.username), notice, undefined, prefill)
    document.body.append(view)
    return view
  }
  const sheetTitle = (): string | null | undefined =>
    document.querySelector('.login-sheet .doc-title')?.textContent
  const tick = (): Promise<void> => new Promise(r => setTimeout(r, 0))
  // Opens the sheet, fills it and submits; resolves once the socket is open
  // and the login frame sent.
  const submit = async (view: HTMLElement): Promise<FakeWS> => {
    if (!document.querySelector('.login-sheet')) view.querySelector<HTMLButtonElement>('#add-account')!.click()
    document.querySelector<HTMLInputElement>('#login-user')!.value = 'tester'
    document.querySelector<HTMLInputElement>('#login-pass')!.value = 'x'
    document.querySelector('#login-form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    const ws = FakeWS.instances[FakeWS.instances.length - 1]
    ws.open()
    await tick()
    return ws
  }

  it('opens from "Add account", focused on the username', () => {
    const view = mount()
    expect(document.querySelector('.login-sheet')).toBeNull()
    view.querySelector<HTMLButtonElement>('#add-account')!.click()
    expect(sheetTitle()).toBe('Add account')
    expect(document.activeElement?.id).toBe('login-user')
    disposeView(view)
  })

  it('groups the server picker by region, every known server once', () => {
    const view = mount()
    view.querySelector<HTMLButtonElement>('#add-account')!.click()
    const groups = [...document.querySelectorAll<HTMLOptGroupElement>('#server-select optgroup')]
    expect(new Set(groups.map(g => g.label)).size).toBe(groups.length)
    const options = groups.flatMap(g => [...g.querySelectorAll('option')].map(o => o.value))
    expect(options.sort()).toEqual(KNOWN_SERVERS.map(s => s.wsUrl).sort())
    disposeView(view)
  })

  it('on touch, focuses the dialog, never a field (iOS raises its autofill sheet)', () => {
    coarse = true
    const view = mount()
    view.querySelector<HTMLButtonElement>('#add-account')!.click()
    expect(document.activeElement?.classList.contains('login-sheet')).toBe(true)
    disposeView(view)
  })

  it('a close mid-handshake closes the socket and a late login_success signs nobody in', async () => {
    const view = mount()
    const ws = await submit(view)
    expect(ws.sent.some(s => s.includes('"login"'))).toBe(true)
    document.querySelector<HTMLButtonElement>('.login-sheet .doc-close')!.click()
    expect(ws.closeCalls).toBeGreaterThan(0)
    ws.receive({ msg: 'login_success', username: 'tester' })
    expect(logins).toEqual([])
    expect(document.activeElement?.id).toBe('add-account')
    disposeView(view)
  })

  it('success closes the sheet and hands over, restoring neither notice nor focus', async () => {
    const view = mount("Couldn't reconnect to crawl.akrasiac.org.", { wsUrl: CAO, username: 'tester' })
    const ws = await submit(view)
    ws.receive({ msg: 'login_success', username: 'tester' })
    expect(logins).toEqual(['tester'])
    expect(ws.closeCalls).toBe(0)
    expect(document.querySelector('.login-sheet')).toBeNull()
    expect(view.querySelector<HTMLElement>('#login-error')!.style.display).toBe('none')
    expect(document.activeElement?.id).not.toBe('add-account')
    disposeView(view)
  })

  it('a socket dropped before any login reply frees the button', async () => {
    const view = mount()
    const ws = await submit(view)
    expect(document.querySelector<HTMLButtonElement>('#login-btn')!.disabled).toBe(true)
    ws.fireClose()
    expect(document.querySelector('#login-sheet-error')!.textContent).toBe('Lost the connection to crawl.dcss.io')
    expect(document.querySelector<HTMLButtonElement>('#login-btn')!.disabled).toBe(false)
    disposeView(view)
  })

  it('removes its visualViewport listeners on close', () => {
    const vv = new EventTarget() as EventTarget & { height: number; offsetTop: number; scale: number }
    Object.assign(vv, { height: 800, offsetTop: 0, scale: 1 })
    const added = new Set<unknown>()
    const add = vv.addEventListener.bind(vv), remove = vv.removeEventListener.bind(vv)
    vv.addEventListener = (t: string, fn: EventListenerOrEventListenerObject | null) => { added.add(fn); add(t, fn) }
    vv.removeEventListener = (t: string, fn: EventListenerOrEventListenerObject | null) => { added.delete(fn); remove(t, fn) }
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    try {
      const view = mount()
      view.querySelector<HTMLButtonElement>('#add-account')!.click()
      expect(added.size).toBe(1)
      document.querySelector<HTMLButtonElement>('.login-sheet .doc-close')!.click()
      expect(added.size).toBe(0)
      disposeView(view)
    } finally {
      if (original) Object.defineProperty(window, 'visualViewport', original)
      else delete (window as { visualViewport?: unknown }).visualViewport
    }
  })

  it('opens on mount for a re-enterable sign-out, carrying the notice, filled in', () => {
    const view = mount("Couldn't reconnect to crawl.akrasiac.org.", { wsUrl: CAO, username: 'tester' })
    expect(sheetTitle()).toBe('Sign in again')
    expect(document.querySelector('.login-sheet-msg')!.textContent).toBe("Couldn't reconnect to crawl.akrasiac.org.")
    expect(document.querySelector<HTMLSelectElement>('#server-select')!.value).toBe(CAO)
    expect(document.querySelector<HTMLInputElement>('#login-user')!.value).toBe('tester')
    // No field focus without a tap; the dialog itself holds focus.
    expect(document.activeElement?.classList.contains('login-sheet')).toBe(true)
    // The sheet explains itself; the main screen doesn't repeat the notice…
    const err = view.querySelector<HTMLElement>('#login-error')!
    expect(err.style.display).toBe('none')
    // …until the sheet is dismissed without signing in.
    document.querySelector<HTMLButtonElement>('.login-sheet .doc-close')!.click()
    expect(err.style.display).toBe('')
    expect(err.textContent).toBe("Couldn't reconnect to crawl.akrasiac.org.")
    disposeView(view)
  })

  it('a sign-out with no notice (cancel, age cutoff) opens nothing, but the next open is filled in', () => {
    const view = mount(undefined, { wsUrl: CAO, username: 'tester' })
    expect(document.querySelector('.login-sheet')).toBeNull()
    view.querySelector<HTMLButtonElement>('#add-account')!.click()
    expect(sheetTitle()).toBe('Add account')
    expect(document.querySelector<HTMLInputElement>('#login-user')!.value).toBe('tester')
    // A mouse/keyboard player lands on the first empty field.
    expect(document.activeElement?.id).toBe('login-pass')
    disposeView(view)
  })

  it('a prefill the form cannot select falls back to the plain notice', () => {
    const view = mount('Connection lost.', { wsUrl: 'wss://example.invalid/socket', username: 'tester' })
    expect(document.querySelector('.login-sheet')).toBeNull()
    expect(view.querySelector('#login-error')!.textContent).toBe('Connection lost.')
    disposeView(view)
  })

  it('the view teardown closes an open sheet', () => {
    const view = mount()
    view.querySelector<HTMLButtonElement>('#add-account')!.click()
    disposeView(view)
    expect(document.querySelector('.login-sheet')).toBeNull()
  })
})
