// The free-text fields (msgwin-get-line, the in-log line input, the menu
// filter) type through the system keyboard: ours has no space bar, and the
// system one brings dictation and VoiceOver. These fields never auto-open
// ours (the abc▴ toggle still does, typing via virtual-keyboard.ts typeIntoInput).
//
// iOS raises the system keyboard, and draws a caret, only for a focus that
// comes from a tap; the focus() these fields get when the server opens them
// answers a WS message, so on a phone the field waits for the player's tap.
// Desktop and hardware keyboards take that focus straight away.

// iOS Smart Punctuation (Settings › General › Keyboard) rewrites quotes and
// "--" as the player types, and autocorrect="off" doesn't stop it. Game
// text (inscriptions, searches, notes) means the ASCII the player typed.
import { devRingPush } from '../util/dev-ring'

const SMART_PUNCTUATION: Record<string, string> = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '—': '--', '–': '-', '…': '...',
}
const SMART_RE = /[‘’“”—–…]/g
const asciiPunctuation =(s: string): string => s.replace(SMART_RE, c => SMART_PUNCTUATION[c])

// A control known to open a field can spare the player that tap: inside its
// own touch handler it focuses this stand-in, which raises the keyboard, and
// the field's focus() a round trip later moves the focus on. That move rests
// on iOS keeping a showing keyboard up across a scripted focus change between
// text inputs — long-standing WebKit behaviour, not a documented contract.
// If it ever stops holding, the field falls back to waiting for a tap. Prime
// only for taps that reliably open a field: a miss shows the keyboard for
// STAND_IN_MS over nothing (and a hardware keyboard types into the stand-in
// meanwhile), while a budget shorter than the round trip is a field with no
// keyboard. Unmeasured either way: a "stand-in gave up" entry in
// __dcssKbdLog followed by a cold field focus is the case for raising it.
//
// Not on Android: Chromium shows the IME for a focus made by the time the
// tap ends, and both callers preventDefault() the touchstart, so the prime
// is most likely a silent focus move there (reasoned from Chromium's IME
// rules, never seen on a device).
const STAND_IN_MS = 2000
let standIn: HTMLInputElement | null = null
let standInTimer = 0

// DEV: window.__dcssKbdLog, the last KBD_LOG_MAX prime decisions and field
// focus arrivals {ts, event, detail} — on a phone, read it over Safari's
// remote inspector. Which side dropped a keyboard (our gate, the stand-in's
// give-up, or iOS across the handoff) can't be told from the screen.
const KBD_LOG_MAX = 50
export function kbdTrace(event: string, detail?: string): void {
  if (!import.meta.env.DEV) return
  devRingPush('__dcssKbdLog', KBD_LOG_MAX,
    detail === undefined ? { ts: Date.now(), event } : { ts: Date.now(), event, detail })
}

// One keyboard configuration for the stand-in and the fields, so the
// handoff doesn't swap the return key or the suggestion bar mid-show.
function textEntry(className: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = className
  input.autocomplete = 'off'
  input.autocapitalize = 'off'
  input.setAttribute('autocorrect', 'off')
  input.spellcheck = false
  input.enterKeyHint = 'done'
  return input
}

export function primeSystemKeyboard(): void {
  if (/android/i.test(navigator.userAgent)) return
  // A field (the open filter, the chat input) already holds the keyboard.
  const active = document.activeElement
  if (active !== standIn && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
    kbdTrace('prime skipped', 'a field holds the focus')
    return
  }
  if (!standIn) {
    standIn = textEntry('keyboard-stand-in')
    standIn.tabIndex = -1
    standIn.setAttribute('aria-label', 'Keyboard')
    standIn.addEventListener('blur', () => clearTimeout(standInTimer))
  }
  // A detached input takes no focus (a body wipe takes the stand-in with it).
  if (!standIn.isConnected) document.body.appendChild(standIn)
  standIn.value = ''
  standIn.focus({ preventScroll: true })
  kbdTrace('primed', document.activeElement === standIn ? 'stand-in focused' : 'stand-in NOT focused')
  clearTimeout(standInTimer)
  standInTimer = window.setTimeout(() => { kbdTrace('stand-in gave up'); standIn?.blur() }, STAND_IN_MS)
}

export function systemKeyboardField(className: string): HTMLInputElement {
  const input = textEntry(className)
  // The wait for that tap shouldn't read as a stuck box. Touch screens only
  // (a mouse or hardware keyboard types into the focus straight away), and
  // cleared by the tap itself, never on focus: iOS does take the unprompted
  // focus, just without keyboard or caret (on-device 2026-09-28, a
  // :focus-hidden hint stayed hidden until a tap elsewhere blurred it).
  if (window.matchMedia?.('(pointer: coarse)').matches) {
    input.placeholder = 'tap to type'
    input.addEventListener('pointerdown', () => { input.placeholder = '' }, { once: true })
  }
  // Registered first, so every later listener sees the rewritten value (the
  // ui_state_sync echo) and no Enter handler fires mid-composition. An IME
  // (dictation, CJK) owns the value until compositionend; rewriting it
  // earlier cancels the composition.
  const rewrite = (): boolean => {
    let value = asciiPunctuation(input.value)
    if (value === input.value) return false
    // The expansions (— → --) can pass maxlength, which only limits typing.
    if (input.maxLength > 0) value = value.slice(0, input.maxLength)
    const caret = Math.min(value.length,
      asciiPunctuation(input.value.slice(0, input.selectionStart ?? input.value.length)).length)
    input.value = value
    input.setSelectionRange(caret, caret)
    return true
  }
  input.addEventListener('input', (e) => { if (!(e as InputEvent).isComposing) rewrite() })
  // A rewrite here has no `input` of its own to carry it to the echo.
  input.addEventListener('compositionend', () => {
    if (rewrite()) input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // Enter that confirms an IME candidate isn't a submit (keyCode 229:
  // Safari's composition keydown).
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) e.stopImmediatePropagation()
  })
  // Focus handed on from a primed stand-in arrives with the keyboard up, and
  // brings what was typed into the stand-in during the round trip.
  input.addEventListener('focus', (e) => {
    if (!standIn || e.relatedTarget !== standIn) {
      if (import.meta.env.DEV) kbdTrace('field focused cold', `${className}; from ${(e.relatedTarget as Element | null)?.className || 'nothing'}`)
      return
    }
    kbdTrace('field focused from stand-in', className)
    input.placeholder = ''
    const carried = standIn.value
    standIn.value = ''
    if (!carried) return
    input.value = input.value + carried
    if (input.maxLength > 0) input.value = input.value.slice(0, input.maxLength)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}
