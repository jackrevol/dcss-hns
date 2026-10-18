import { attachScrollCue } from '../util/scroll-cue'

// Shared dismissal wiring for the full-screen surfaces mounted on document.body
// (the markdown doc viewer and the crypt). Appends `el` to the body, closes it on
// Escape, and returns a close() that removes the node and detaches the listener.
// Each caller supplies its own markup and any extra close triggers (a button, a
// backdrop tap) by wiring them to the returned handle.
// Open overlays, oldest first, as their close REQUESTS (which an intercept
// may veto). A single shared Escape listener requests only the topmost, so
// stacking (e.g. a Help doc over the Settings card) unwinds one layer per
// press instead of collapsing the whole stack.
const stack: Array<() => void> = []

// A user close request: 'back' = Escape or the Android back gesture (step
// back one level), 'dismiss' = the sheet's ✕ or a scrim tap (leave the
// surface). An intercept returns true when it handled the request itself —
// the overlay then stays open (Settings steps back out of its sub-pages, or
// asks before discarding unsaved edits).
export type CloseVia = 'back' | 'dismiss'
export type CloseIntercept = (via: CloseVia) => boolean

function onKey(e: KeyboardEvent): void {
  // An IME (CJK, dictation) uses Escape to cancel its composition.
  if (e.key === 'Escape' && !e.isComposing) closeTopOverlay()
}

// Request the topmost overlay's close — the same one the Escape listener
// targets. Returns whether one was open (even if its intercept kept it
// open), so a caller routing a platform close signal (the Android back
// gesture) can stop once the overlay consumed it.
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top()
  return true
}

// Whether any body-mounted overlay is currently open. Surfaces underneath (the
// game view's document keydown handler) consult this to stop forwarding keys to
// content the overlay is covering.
export function isOverlayOpen(): boolean {
  return stack.length > 0
}

// `onClose` runs once on whichever trigger closes the overlay (Escape, the
// caller's own buttons, closeTopOverlay) — the place to release listeners
// the overlay registered on window/document, which `el.remove()` can't.
// The returned close() always closes; `intercept` sees only the Escape/back
// request (and, via mountBackdrop/mountCardOverlay, the scrim and ✕).
export function mountOverlay(el: HTMLElement, onClose?: () => void, intercept?: CloseIntercept): () => void {
  document.body.appendChild(el)
  let closed = false
  function close(): void {
    if (closed) return
    closed = true
    el.remove()
    const i = stack.indexOf(requestBack)
    if (i !== -1) stack.splice(i, 1)
    if (stack.length === 0) document.removeEventListener('keydown', onKey)
    onClose?.()
  }
  function requestBack(): void {
    if (!intercept?.('back')) close()
  }
  if (stack.length === 0) document.addEventListener('keydown', onKey)
  stack.push(requestBack)
  return close
}

// The bare modal-backdrop layer (the .doc-backdrop dim tier): body-mounted
// via mountOverlay, dismissed by Escape or a direct backdrop tap. Callers
// append their own dialog content and own its ARIA roles — this is the
// shared bottom half of mountCardOverlay, split out for dialogs that ARE
// their own card (the crypt's character-card modal).
export function mountBackdrop(
  cls?: string, onClose?: () => void, intercept?: CloseIntercept,
): { backdrop: HTMLElement; close: () => void; requestDismiss: () => void } {
  const backdrop = document.createElement('div')
  backdrop.className = cls ? `doc-backdrop ${cls}` : 'doc-backdrop'
  const close = mountOverlay(backdrop, onClose, intercept)
  const requestDismiss = (): void => { if (!intercept?.('dismiss')) close() }
  // Only a press that also began on the scrim dismisses: a text selection
  // dragged out of a field ends in a click on the common ancestor — the
  // backdrop.
  let pressedScrim = false
  backdrop.addEventListener('pointerdown', (e) => { pressedScrim = e.target === backdrop })
  backdrop.addEventListener('click', (e) => {
    const pressed = pressedScrim
    pressedScrim = false
    if (e.target === backdrop && pressed) requestDismiss()
  })
  return { backdrop, close, requestDismiss }
}

// Shared sheet shell (dimmed backdrop + full-height bottom sheet + titled
// header with ✕), used by the doc viewer and the settings page — one
// anatomy, so a Help doc opened from Settings stacks as sheet over sheet.
// Returns the empty body element for the caller to fill, plus close();
// Escape (via mountOverlay), the ✕ button, and a backdrop tap all dismiss,
// each through `intercept` when given.
// The `cls` classes extend the doc-* base styling per surface.
export function mountCardOverlay(
  title: string,
  cls: { backdrop?: string; card?: string; body?: string } = {},
  onClose?: () => void,
  intercept?: CloseIntercept,
): { backdrop: HTMLElement; body: HTMLElement; close: () => void } {
  const { backdrop, close, requestDismiss } = mountBackdrop(
    'sheet-backdrop' + (cls.backdrop ? ` ${cls.backdrop}` : ''), onClose, intercept)
  const card = document.createElement('div')
  card.className = 'doc-card' + (cls.card ? ` ${cls.card}` : '')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', title)
  const header = document.createElement('div')
  header.className = 'doc-header'
  const titleEl = document.createElement('span')
  titleEl.className = 'doc-title'
  titleEl.textContent = title
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'doc-close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.textContent = '✕'
  header.appendChild(titleEl)
  header.appendChild(closeBtn)
  const body = document.createElement('div')
  body.className = cls.body ?? 'doc-body'
  card.appendChild(header)
  card.appendChild(body)
  backdrop.appendChild(card)
  closeBtn.addEventListener('click', requestDismiss)
  attachScrollCue(header, body)
  return { backdrop, body, close }
}
