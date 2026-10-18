// Settings overlay: a body-mounted full-screen modal reusing the doc-viewer
// shell classes, opened from the login footer and from the HUD id line's
// ⚙ chip in-game. The home page is a stack of sections (map display,
// touch controls, help); a section may take over the body for a
// sub-page (the control-set editor) and return via backHome. Changes apply
// live via window events, fired by the stores themselves (control-sets.ts
// mutators, setPref in prefs.ts): CONTROLS_CHANGED_EVENT (touch panel
// re-renders), RENDER_MODE_CHANGED_EVENT (game view swaps renderers).

import { mountBackdrop, mountCardOverlay, mountOverlay, type CloseIntercept } from './overlay'
import {
  cloneSet, deleteControlSet, encodeControlSet, getActiveControlSet,
  importControlSet, isValidTabName, listControlSets, newSetId, saveControlSet,
  setActiveControlSet, slotLabel, slotTitle, STANDARD_ID,
  GRID_ROWS, MAX_COLS, MAX_MACRO_LEN, PICKER_KEYS,
} from '../game/input/control-sets'
import type { ControlSet, ControlTabDef, SlotDef } from '../game/input/control-sets'
import { dcssToHtml } from '../game/dcss-colors'
import { DPAD_LAYOUT } from '../game/input/touch'
import { defaultPref, getPref, setPref, type Prefs } from '../prefs'
import { DPAD_STOPS, MSGLOG_FONT_STOPS, MSGLOG_LINE_STOPS, nearestStop } from '../ui-scale'
import { strokeIcon } from '../util/svg-icon'
import { openGesturesDoc } from './docs'

// Close handle of the last-mounted settings card, for surfaces that replace
// it (the floating size palette). May be stale after ✕/Escape closed the
// card — harmless, mountOverlay's close() is idempotent.
let closeSettings: (() => void) | null = null

// The showing page's say over the card's close requests (overlay.ts
// CloseIntercept): sub-pages take Escape/back as one step back, and the
// editor holds ✕/scrim while it has unsaved edits. Null on the home page
// and once the sheet has closed (so a closed editor isn't kept alive by it).
let pageIntercept: CloseIntercept | null = null

// The home page's scroll offset when a sub-page (which opens at its own top)
// took over the body, recorded by leaveHome and restored by backHome so you
// land back at the set list rather than wherever the sub-page's height
// clamped it.
let homeScroll = 0

export function openSettings(): void {
  closePalette?.()  // one surface at a time; a stale palette would desync
  const { body, close } = mountCardOverlay('Settings', {
    backdrop: 'settings-backdrop',
    card: 'settings-card',
    body: 'settings-body',
  }, () => { pageIntercept = null }, via => pageIntercept?.(via) ?? false)
  closeSettings = close
  renderHome(body)
}

// --- small DOM helpers -------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function button(label: string, className: string, onTap: () => void): HTMLButtonElement {
  const b = el('button', className, label)
  b.type = 'button'
  b.addEventListener('click', onTap)
  return b
}

// One home-page section in grouped-list anatomy: a header, one cell holding
// the controls, and the explanation as a footer under the cell. `bare`
// holds the controls in a plain box instead (a lone segmented control sits
// on the sheet itself); `list` drops the cell's padding
// for row lists.
function section(
  body: HTMLElement, title: string,
  opts: { footer?: string; bare?: boolean; list?: boolean } = {},
): HTMLElement {
  const sec = el('section', 'settings-sec')
  sec.appendChild(el('h2', 'settings-h', title))
  const cell = el('div', opts.bare ? '' : 'settings-cell' + (opts.list ? ' is-list' : ''))
  sec.appendChild(cell)
  if (opts.footer) sec.appendChild(el('p', 'settings-footer', opts.footer))
  body.appendChild(sec)
  return cell
}

// A row that opens something else (a doc, the palette): label + chevron.
function navRow(label: string, onTap: () => void): HTMLButtonElement {
  return button(label, 'settings-nav', onTap)
}

// Crawl keys/macros and player names aren't prose — keep mobile keyboards
// from "helping".
function noAutofix<T extends HTMLInputElement | HTMLTextAreaElement>(field: T): T {
  field.spellcheck = false
  field.setAttribute('autocapitalize', 'off')
  field.setAttribute('autocorrect', 'off')
  return field
}

// "My controls", "My controls 2", … first name not already taken.
function freshName(): string {
  const taken = new Set(listControlSets().map(s => s.name))
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'My controls' : `My controls ${n}`
    if (!taken.has(name)) return name
  }
}

// A clone with a new id and a fresh untaken name — the basis of Duplicate,
// New set, and Duplicate & edit.
function freshClone(base: ControlSet): ControlSet {
  return cloneSet(base, newSetId(), freshName())
}

// --- home page ---------------------------------------------------------------

// Section order: in-game before out-of-game, quick toggles → size tuning →
// deep customization, help last. The size block is context-dependent:
// out-of-game the card is the only surface, so the Message log and D-pad
// sections carry previews (specimen pad, fake log) that make adjusting
// non-blind; in-game those previews are simulations of a subject one tap
// away, so both sections collapse into a single "Sizes" entry opening the
// floating palette over the live game.
function renderHome(body: HTMLElement): void {
  body.innerHTML = ''
  pageIntercept = null
  renderDisplaySection(body)
  renderMonsterListSection(body)
  if (document.getElementById('game-view')) {
    renderSizesSection(body)
  } else {
    renderMsglogSection(body)
    renderDpadSection(body)
  }
  renderControlsSection(body)
  renderSpritesSection(body)
  renderHelpSection(body)
}

// Sub-page navigation (viewer, editor); see homeScroll.
function leaveHome(body: HTMLElement): void {
  homeScroll = body.scrollTop
}

function backHome(body: HTMLElement): void {
  renderHome(body)
  body.scrollTop = homeScroll
}

// --- touch-controls section (control-set list) --------------------------------

// D-pad size (out-of-game only): slider plus a real-size specimen pad
// (settings covers the whole screen, so without one the resize would be
// adjusted blind). The full 3×3 shows what one button alone can't — the
// pad's overall footprint. It tracks --pz-dpad via CSS; no re-render needed
// as the slider moves. In portrait the whole strip scales with the d-pad
// (its height cap derives from --tc-dpad); in landscape only the floating
// d-pad does.
function renderDpadSection(body: HTMLElement): void {
  const cell = section(body, 'D-pad')
  const preview = el('div', 'set-dpad-preview')
  preview.setAttribute('aria-hidden', 'true')
  const pad = el('div', 'set-dpad-pad')
  // Faces come from the live pad's own layout; the '.'-sending center is the
  // dimmed wait slot.
  for (const d of DPAD_LAYOUT.flat()) {
    const isWait = 'text' in d && d.text === '.'
    pad.appendChild(el('div', 'set-dpad-specimen' + (isWait ? ' wait' : ''), d.label))
  }
  preview.appendChild(pad)
  cell.appendChild(preview)
  cell.appendChild(dpadSlider())
}

const DELETE_ARM_MS = 4000

function renderControlsSection(body: HTMLElement): void {
  const cell = section(body, 'Control sets', {
    list: true,
    footer: 'Control sets define the buttons on the three control tabs.',
  })

  const sets = listControlSets()
  // Reuse the list already built above rather than getActiveControlSet(), which
  // would rebuild it; fall back to Standard exactly as getActiveControlSet does
  // when the stored id no longer names a set.
  const wanted = getPref('controlSetId')
  const activeId = sets.some(s => s.id === wanted) ? wanted : STANDARD_ID
  const list = el('div', 'set-list')
  cell.appendChild(list)

  for (const set of sets) {
    const row = el('div', 'set-row' + (set.id === activeId ? ' active' : ''))

    const main = button('', 'set-row-main', () => {
      setActiveControlSet(set.id)
      renderHome(body)
    })
    // A leading ✓ column: marks the active set and
    // holds the text column for the rows without one.
    main.appendChild(el('span', 'set-radio', set.id === activeId ? '✓' : ''))
    main.appendChild(el('span', 'set-name', set.name))
    if (set.builtin) main.appendChild(el('span', 'set-badge', 'built-in'))
    row.appendChild(main)

    const actions = el('div', 'set-row-actions')
    actions.hidden = true
    const more = button('⋯', 'set-row-more', () => { actions.hidden = !actions.hidden })
    more.setAttribute('aria-label', `Actions for ${set.name}`)
    row.appendChild(more)
    list.appendChild(row)

    actions.appendChild(button('View', 'set-action', () => {
      leaveHome(body)
      renderViewer(body, set)
    }))
    if (!set.builtin) {
      actions.appendChild(button('Edit', 'set-action', () => {
        leaveHome(body)
        renderEditor(body, set, false)
      }))
    }
    actions.appendChild(button('Duplicate', 'set-action', () => {
      saveControlSet(freshClone(set))
      renderHome(body)
    }))
    const exp = button('Export', 'set-action', () => exportSet(set, exp, actions))
    actions.appendChild(exp)
    if (!set.builtin) {
      const del = button('Delete', 'set-action set-action-danger', () => {
        if (del.dataset.armed !== '1') {
          del.dataset.armed = '1'
          del.textContent = 'Really delete?'
          // An arming left alone lapses, so a later stray tap can't confirm it.
          setTimeout(() => {
            delete del.dataset.armed
            del.textContent = 'Delete'
          }, DELETE_ARM_MS)
          return
        }
        deleteControlSet(set.id)
        renderHome(body)
      })
      actions.appendChild(del)
    }
    list.appendChild(actions)
  }

  // New set / Import… are the list's own action rows, on its text column.
  const actionsBar = el('div', 'set-action-rows')
  cell.appendChild(actionsBar)

  // Import area (collapsed behind the button)
  const importWrap = el('div', 'settings-import')
  importWrap.hidden = true
  const importField = noAutofix(el('textarea', 'settings-import-field settings-input'))
  importField.placeholder = 'Paste a pocketzot-controls{…} string'
  importField.rows = 3
  const importErr = el('div', 'settings-error')
  importErr.hidden = true
  const importGo = button('Import', 'settings-btn', () => {
    importErr.hidden = true
    try {
      const set = importControlSet(importField.value)
      setActiveControlSet(set.id)  // fresh-install flow: imported = wanted
      renderHome(body)
    } catch (err) {
      importErr.textContent = `Couldn't import: ${err instanceof Error ? err.message : String(err)}`
      importErr.hidden = false
    }
  })
  importWrap.appendChild(importField)
  importWrap.appendChild(importErr)
  importWrap.appendChild(importGo)

  actionsBar.appendChild(button('New set', 'set-action-row', () => {
    // Start from whatever is active — the closest thing to "what I have now".
    leaveHome(body)
    renderEditor(body, freshClone(getActiveControlSet()), true)
  }))
  actionsBar.appendChild(button('Import…', 'set-action-row', () => {
    importWrap.hidden = !importWrap.hidden
    if (!importWrap.hidden) importField.focus()
  }))
  cell.appendChild(importWrap)
}

// --- display sections ----------------------------------------------------------

// Segmented radio bound to an enum- or bool-valued pref. setPref fires the
// pref's live-apply event itself (prefs.ts PREF_EVENTS), so a mounted
// game/login view picks the change up immediately.
function segPref<K extends 'mapRenderMode' | 'monsterListMode' | 'loginSprites'>(
  ariaLabel: string,
  prefKey: K,
  options: ReadonlyArray<{ value: Prefs[K]; label: string }>,
): HTMLElement {
  const seg = el('div', 'settings-seg seg')
  seg.setAttribute('role', 'radiogroup')
  seg.setAttribute('aria-label', ariaLabel)
  const active = getPref(prefKey)
  for (const { value, label } of options) {
    const b = button(label, 'settings-btn' + (value === active ? ' active' : ''), () => {
      if (getPref(prefKey) === value) return
      setPref(prefKey, value)
      for (const sib of seg.children) {
        sib.classList.toggle('active', sib === b)
        sib.setAttribute('aria-checked', String(sib === b))
      }
    })
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-checked', String(value === active))
    seg.appendChild(b)
  }
  return seg
}

// Numeric prefs whose legal values are a stop table (ui-scale.ts).
type SliderPrefKey = 'dpadSize' | 'msglogLines' | 'msglogFont'

// Discrete slider bound to a stop-table pref — the page's ordered-magnitude
// counterpart to segPref's state adjectives. A native range input over the
// stop indices, so the browser owns drag, scroll-vs-drag, keyboard and
// VoiceOver; no gesture code of ours (a tap-stop radiogroup looked like a
// slider but couldn't be dragged). Laid out with
// a small and a large symbol inline at the track's ends (`ends`,
// decorative), ticks under the track at the stops; no captions — each
// slider's live preview shows the value. No fill left of the knob: WebKit
// has no CSS hook for it, and it isn't worth script. The stock stop keeps a
// ring tick, and the stored value snaps to the nearest stop for display,
// mirroring ui-scale's clamp. setPref fires the live-apply event (and bails
// on an equal value); ui-scale rewrites the CSS variables, which is also
// what updates the previews. Returns the row; the input carries the
// aria-label.
function sliderPref(
  ariaLabel: string,
  prefKey: SliderPrefKey,
  stops: readonly number[],
  ends: [string, string],
): HTMLElement {
  const input = el('input', 'set-slider')
  input.type = 'range'
  input.min = '0'
  input.max = String(stops.length - 1)
  input.step = '1'
  input.value = String(stops.indexOf(nearestStop(stops, getPref(prefKey))))
  input.setAttribute('aria-label', ariaLabel)
  const sync = (): void => input.setAttribute('aria-valuetext', String(stops[Number(input.value)]))
  sync()
  input.addEventListener('input', () => {
    setPref(prefKey, stops[Number(input.value)])
    sync()
  })
  const stock = defaultPref(prefKey)
  const ticks = el('div', 'set-slider-ticks')
  ticks.setAttribute('aria-hidden', 'true')
  for (const value of stops) ticks.appendChild(el('span', 'set-slider-tick' + (value === stock ? ' default' : '')))
  const body = el('div', 'set-slider-body')
  body.append(input, ticks)
  const [start, end] = ends.map((html) => {
    const span = el('span', 'set-slider-end')
    span.setAttribute('aria-hidden', 'true')
    span.innerHTML = html
    return span
  })
  const row = el('div', 'set-slider-row')
  row.append(start, body, end)
  return row
}

// End symbols: small at the start, large at the end (A / A).
// Symbols, not specimens — the live previews show the true size.
const linesIcon = (n: number, w: number, h: number): string => strokeIcon(w, h,
  Array.from({ length: n }, (_, i) => {
    const y = 1 + i * ((h - 2) / (n - 1))
    return `<path d="M1 ${y.toFixed(1)}H${w - 1}" stroke-width="1.8"/>`
  }).join(''))
const padIcon = (s: number): string => {
  const c = (s - 2) / 3
  const cells: string[] = []
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
    cells.push(`<rect x="${(1.6 + k * c).toFixed(1)}" y="${(1.6 + r * c).toFixed(1)}"`
      + ` width="${(c - 1.2).toFixed(1)}" height="${(c - 1.2).toFixed(1)}" rx="1" stroke-width="1.2"/>`)
  }
  return strokeIcon(s, s, cells.join(''))
}
const letterIcon = (px: number): string =>
  `<span class="set-slider-letter" style="font-size:${px}px">A</span>`

// One spec per slider, shared by the settings sections and the floating
// palette so stops, symbols, and aria-labels (also test selectors) can't
// diverge between the two surfaces.
const dpadSlider = () =>
  sliderPref('D-pad size', 'dpadSize', DPAD_STOPS, [padIcon(13), padIcon(21)])
const msglogLinesSlider = () =>
  sliderPref('Message log lines', 'msglogLines', MSGLOG_LINE_STOPS,
    [linesIcon(3, 16, 10), linesIcon(6, 18, 18)])
const msglogFontSlider = () =>
  sliderPref('Message log text size', 'msglogFont', MSGLOG_FONT_STOPS, [letterIcon(13), letterIcon(21)])

// --- floating size palette ----------------------------------------------------

// Close handle of the open palette; null when none. openSettings invokes it
// so the two surfaces never coexist (a covered palette would show stale values).
let closePalette: (() => void) | null = null

// The "Adjust sizes" palette: the same sliders, floating bare over the live
// map — purely presentation, since sliders apply through ui-scale's root
// variables wherever they're mounted. Top-anchored because both subjects
// (log, touch strip) live at the bottom; no backdrop, so the game underneath
// stays fully touch-interactive and IS the preview. Mounted via mountOverlay
// for stack Escape handling; that also suppresses game key forwarding while
// open (touch is untouched). Reachable only from the settings card while a
// game view is mounted (renderSizesSection).
function openSizePalette(): void {
  const palette = el('div', 'size-palette')
  // Keep slider taps from stealing keyboard focus off the game view.
  palette.addEventListener('mousedown', (e) => e.preventDefault())
  // Cleanup rides onClose, so Escape (which closes via the overlay stack,
  // never through dismiss) releases the watch and the handle too.
  const dismiss = mountOverlay(palette, () => {
    unmountWatch.disconnect()
    closePalette = null
  })
  closePalette = dismiss
  // The game ending would strand the palette over the lobby — close along
  // with the game view.
  const unmountWatch = new MutationObserver(() => {
    if (!document.getElementById('game-view')) dismiss()
  })
  const app = document.getElementById('app')
  if (app) unmountWatch.observe(app, { childList: true })

  // ✕ heads its own row — absolutely positioning it in the corner would
  // overlap the top slider's large end symbol. No captions: each slider's
  // end symbols name it, and the live game underneath is the preview.
  // Slider order mirrors the game's vertical stack (log above the touch
  // strip), so each control sits on the palette the way its subject sits on
  // the screen: message log first, d-pad last.
  const x = button('✕', 'size-palette-close', dismiss)
  x.setAttribute('aria-label', 'Close')
  const header = el('div', 'size-palette-header')
  header.appendChild(el('p', 'size-palette-title', 'Sizes'))
  header.appendChild(x)
  palette.appendChild(header)
  palette.appendChild(msglogLinesSlider())
  palette.appendChild(msglogFontSlider())
  palette.appendChild(dpadSlider())
}

// The in-game replacement for the two out-of-game size sections: the header
// names both subjects so they stay findable in either mode, and a single
// enabled button opens the palette (which holds all three sliders).
// renderHome only calls this while a game view is mounted — with no game
// behind, the palette would float over the login screen adjusting nothing
// visible, and a disabled button would just sit there unactionable.
function renderSizesSection(body: HTMLElement): void {
  const cell = section(body, 'D-pad and message log', {
    list: true,
    footer: 'Adjust D-pad and message log sizes over the live game.',
  })
  cell.appendChild(navRow('Adjust sizes', () => {
    closeSettings?.()
    openSizePalette()
  }))
}

function renderMsglogSection(body: HTMLElement): void {
  const cell = section(body, 'Message log', {
    footer: 'Recent messages shown over the map. Tap the log in-game for full history.',
  })
  // Fake log both sliders manipulate. DOM order is newest-first: the preview
  // is column-reverse like the real log, so index 0 lands at the visual
  // bottom and extra lines get trimmed off the top. Texts are real game
  // messages, wire-exact: the yellow opener is the game-start welcome spam
  // (main.cc _announce_goal_message sends it wrapped in <yellow>), and the
  // long lines demonstrate how the font-size choice changes wrapping.
  // Exactly SIX strings, so the 6-line setting stays fully backed even on a
  // viewport wide enough that nothing wraps (iPad); on phones the wrapped
  // surplus clips off the top like real scrolled-away history.
  const SAMPLE_LINES = [
    'Your surroundings suddenly seem different.',
    'As you read the scroll of teleportation, it crumbles to dust.',
    'You now have 147 gold pieces (gained 37).',
    'You kill the kobold!',
    'A kobold comes into view. It is wielding a club.',
    "<yellow>It's a long way down to the Orb of Zot, but that shouldn't be any trouble.</yellow>",
  ]
  const frame = el('div', 'set-msglog-frame')
  const preview = el('div', 'set-msglog-preview msglog-box')
  preview.setAttribute('aria-hidden', 'true')
  for (const line of SAMPLE_LINES) {
    // Mirror the message log's row shape (message-log.ts row): turn-mark slot plus
    // dcssToHtml-rendered content, so metrics and colors match the real log.
    const p = el('p', 'game-msg')
    p.appendChild(el('span', 'msg-turn-mark', ' '))
    const content = document.createElement('span')
    content.innerHTML = dcssToHtml(line)
    p.appendChild(content)
    preview.appendChild(p)
  }
  frame.appendChild(preview)
  cell.appendChild(frame)
  cell.appendChild(msglogLinesSlider())
  cell.appendChild(msglogFontSlider())
}

function renderDisplaySection(body: HTMLElement): void {
  section(body, 'Map display', {
    bare: true,
    footer: 'A two-finger long-press on the map also toggles this mid-game.',
  }).appendChild(segPref('Map display', 'mapRenderMode', [
    { value: 'ascii', label: 'ASCII' },
    { value: 'tiles', label: 'Tiles' },
  ]))
}

function renderMonsterListSection(body: HTMLElement): void {
  section(body, 'Monster list', {
    bare: true,
    footer: 'In-game list of monsters in view.',
  }).appendChild(segPref('Monster list', 'monsterListMode', [
    { value: 'hidden', label: 'Hidden' },
    { value: 'collapsed', label: 'Collapsed' },
    { value: 'full', label: 'Full' },
  ]))
}

// Hidden/Shown segments rather than a lone checkbox: matches the page's
// segmented idiom (state adjectives, like the monster list's).
function renderSpritesSection(body: HTMLElement): void {
  section(body, 'Character sprites', {
    bare: true,
    footer: 'Recently played characters shown on the login screen.',
  }).appendChild(segPref('Character sprites', 'loginSprites', [
    { value: false, label: 'Hidden' },
    { value: true, label: 'Shown' },
  ]))
}

// --- help section --------------------------------------------------------------

function renderHelpSection(body: HTMLElement): void {
  // The docs mount their own card above this one (doc z-index > settings).
  // About and What's new live on the login/lobby footers; in-game Help just
  // surfaces the gesture cheatsheet.
  section(body, 'Help', { list: true }).appendChild(navRow('Gestures', openGesturesDoc))
}

// Copy the export string; iOS clipboard needs a user gesture, which this is.
// Success feedback morphs the Export button itself ("Copied ✓") — right where
// the finger just was, no layout shift. On failure (or where the API is
// missing) fall back to a visible, selected textarea on its own row.
function exportSet(set: ControlSet, btn: HTMLButtonElement, host: HTMLElement): void {
  const str = encodeControlSet(set)
  const flash = (): void => {
    btn.textContent = 'Copied ✓'
    btn.classList.add('flash')
    btn.disabled = true
    setTimeout(() => {
      btn.textContent = 'Export'
      btn.classList.remove('flash')
      btn.disabled = false
    }, 1500)
  }
  const fallback = (): void => {
    host.querySelector('.settings-export-out')?.remove()
    const out = el('div', 'settings-export-out')
    const field = el('textarea', 'settings-import-field settings-input')
    field.value = str
    field.readOnly = true
    field.rows = 3
    field.addEventListener('focus', () => field.select())
    out.appendChild(field)
    host.appendChild(out)
    field.focus()
  }
  const clip = navigator.clipboard
  if (clip?.writeText) clip.writeText(str).then(flash, fallback)
  else fallback()
}

// --- read-only viewer ----------------------------------------------------------

// iOS shows no title-attribute tooltips, so the editor's picker narrates the
// touched key through this. Only there: the glosses state a key's *default*
// meaning, which is the honest claim while choosing what to assign — but not
// while viewing a finished layout, where a slot may exist for its submenu or
// Shift/Ctrl-prefixed role and the bare gloss would misdescribe it (so the
// read-only viewer shows faces only). Special-key titles already name the key
// ("Ctrl+P — Replay messages"), so only text slots get the face-label prefix.
function slotDesc(slot: SlotDef): string {
  return slotTitle(slot) ?? `Send "${slot.text ?? ''}"`
}

// A slot's face label, or the empty-cell marker.
function faceLabel(slot: SlotDef | null): string {
  return slot ? slotLabel(slot) : '·'
}

function slotNarration(slot: SlotDef | null): string {
  if (!slot) return 'Empty slot'
  if (slot.key !== undefined) return slotDesc(slot)
  return `${slotLabel(slot)} — ${slotDesc(slot)}`
}

function renderViewer(body: HTMLElement, set: ControlSet): void {
  body.innerHTML = ''

  const heading = el('h2', 'settings-h', set.name)
  if (set.builtin) heading.appendChild(el('span', 'set-badge', 'built-in'))
  body.appendChild(heading)

  const tabsHost = el('div', 'ed-tabs')
  body.appendChild(tabsHost)

  for (const tab of set.tabs) {
    const box = el('div', 'ed-tab')
    const head = el('div', 'ed-tab-head')
    head.appendChild(el('span', 'ed-tab-charlabel', `Tab ${tab.name}`))
    box.appendChild(head)

    const grid = el('div', 'ed-grid')
    grid.style.gridTemplateColumns = `repeat(${tab.cols}, 1fr)`
    for (const slot of tab.slots) {
      grid.appendChild(el('div', 'ed-slot static' + (slot ? '' : ' empty'), faceLabel(slot)))
    }
    box.appendChild(grid)
    tabsHost.appendChild(box)
  }

  const foot = el('div', 'settings-actions is-pinned')
  foot.appendChild(button('Back', 'settings-btn', () => backHome(body)))
  if (set.builtin) {
    // Same path as New set: an unsaved clone, saved (and activated) only
    // on the editor's own Save.
    foot.appendChild(button('Duplicate & edit', 'settings-btn settings-btn-primary', () =>
      renderEditor(body, freshClone(set), true)))
  } else {
    foot.appendChild(button('Edit', 'settings-btn settings-btn-primary', () =>
      renderEditor(body, set, false)))
  }
  body.appendChild(foot)
  body.scrollTop = 0
  pageIntercept = (via) => {
    if (via === 'dismiss') return false
    backHome(body)
    return true
  }
}

// --- editor ------------------------------------------------------------------

interface TabModel {
  name: string
  cols: 3 | 4
  grid: (SlotDef | null)[]  // always 3×4 row-major while editing, so toggling
                            // a tab 4→3→4 never loses its 4th-column keys
}

function padGrid(tab: ControlTabDef): (SlotDef | null)[] {
  const grid: (SlotDef | null)[] = []
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < MAX_COLS; c++) {
      grid.push(c < tab.cols ? (tab.slots[r * tab.cols + c] ?? null) : null)
    }
  }
  return grid
}

function cropGrid(grid: (SlotDef | null)[], cols: 3 | 4): (SlotDef | null)[] {
  const slots: (SlotDef | null)[] = []
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < cols; c++) slots.push(grid[r * MAX_COLS + c])
  }
  return slots
}

// Ready an editor bubble to follow its slot's row in an .ed-grid: it spans
// the full row, and --notch-x centres the notch on column `col` of `cols`
// equal tracks separated by the grid's --ed-gap.
function placeBubble(bubble: HTMLElement, col: number, cols: number): HTMLElement {
  bubble.style.setProperty('--notch-x',
    `calc((100% - ${cols - 1} * var(--ed-gap)) * ${(col + 0.5) / cols} + ${col} * var(--ed-gap))`)
  return bubble
}

function renderEditor(body: HTMLElement, set: ControlSet, isNew: boolean): void {
  body.innerHTML = ''
  // A new set always opens at 3×4 — the full canvas — regardless of the
  // cloned base's grid sizes; its keys land in the first three columns.
  const tabs: TabModel[] = set.tabs.map(tab => ({
    name: tab.name,
    cols: isNew ? 4 : tab.cols,
    grid: padGrid(tab),
  }))
  // (tabIdx, cell) of the slot the picker is editing, or null when closed
  let picking: { tab: number; cell: number } | null = null
  // Source slot of an armed move — the next slot tap swaps with it
  let moving: { tab: number; cell: number } | null = null

  body.appendChild(el('h2', 'settings-h', isNew ? 'New control set' : 'Edit control set'))

  const nameRow = el('label', 'ed-name-row', 'Name ')
  const nameInput = el('input', 'ed-name-input settings-input')
  nameInput.value = set.name
  nameInput.maxLength = 48
  nameInput.spellcheck = false
  nameRow.appendChild(nameInput)
  body.appendChild(nameRow)

  const tabsHost = el('div', 'ed-tabs')
  body.appendChild(tabsHost)

  // The key picker (assigns into `picking`) and the move-in-progress hint
  // are bubbles: renderTabs slots whichever is live into the edited tab's
  // grid right under the slot's row, notch pointing up at the slot.
  const picker = el('div', 'ed-picker ed-bubble')
  const moveHint = el('div', 'ed-move-hint ed-bubble')

  function renderTabs(): void {
    tabsHost.innerHTML = ''
    tabs.forEach((tab, ti) => {
      const box = el('div', 'ed-tab')

      const head = el('div', 'ed-tab-head')
      const charLabel = el('label', 'ed-tab-charlabel', 'Tab label ')
      const charInput = noAutofix(el('input', 'ed-tab-char settings-input'))
      charInput.value = tab.name
      // maxLength counts UTF-16 units, so 2 admits a surrogate-pair emoji;
      // isValidTabName is the codepoint check enforcing "one visible
      // character" — the same rule the importer applies.
      charInput.maxLength = 2
      charInput.addEventListener('input', () => {
        if (isValidTabName(charInput.value)) tab.name = charInput.value
      })
      // Blank or whitespace stays whatever it was — a tab must keep a
      // visible label (import enforces the same rule).
      charInput.addEventListener('blur', () => { charInput.value = tab.name })
      charLabel.appendChild(charInput)
      head.appendChild(charLabel)

      const sizeToggle = el('div', 'ed-size-toggle seg')
      for (const cols of [3, 4] as const) {
        const sb = button(`3×${cols}`, 'ed-size-btn' + (tab.cols === cols ? ' active' : ''), () => {
          tab.cols = cols
          // A bubble whose slot this just hid (4th column, now 3×3) goes
          const hidden = (at: typeof picking): boolean =>
            at?.tab === ti && at.cell % MAX_COLS >= cols
          if (hidden(picking)) picking = null
          if (hidden(moving)) moving = null
          renderTabs()
        })
        sizeToggle.appendChild(sb)
      }
      head.appendChild(sizeToggle)
      box.appendChild(head)

      const grid = el('div', 'ed-grid')
      grid.style.gridTemplateColumns = `repeat(${tab.cols}, 1fr)`
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < tab.cols; c++) {
          const cell = r * MAX_COLS + c
          const slot = tab.grid[cell]
          const sb = button(faceLabel(slot), 'ed-slot' + (slot ? '' : ' empty'), () => {
            if (moving) {
              if (moving.tab === ti && moving.cell === cell) { cancelMove(); return }
              const src = tabs[moving.tab].grid[moving.cell]
              tabs[moving.tab].grid[moving.cell] = tab.grid[cell]
              tab.grid[cell] = src
              cancelMove()
              return
            }
            // A second tap on the slot under edit closes its bubble
            if (picking?.tab === ti && picking.cell === cell) closePicker()
            else openPicker(ti, cell)
          })
          if (slot) {
            const title = slotTitle(slot)
            if (title) sb.title = title
          }
          const marked = picking ?? moving
          if (marked && marked.tab === ti && marked.cell === cell) sb.classList.add('picking')
          grid.appendChild(sb)
        }
        const at = picking ?? moving
        if (at && at.tab === ti && Math.floor(at.cell / MAX_COLS) === r) {
          grid.appendChild(placeBubble(picking ? picker : moveHint, at.cell % MAX_COLS, tab.cols))
        }
      }
      box.appendChild(grid)
      tabsHost.appendChild(box)
    })
  }

  function openPicker(tab: number, cell: number): void {
    picking = { tab, cell }
    buildPicker()
    renderTabs()
    picker.scrollIntoView({ block: 'nearest' })
  }

  function closePicker(): void {
    picking = null
    renderTabs()
  }

  function assign(slot: SlotDef | null): void {
    if (!picking) return
    tabs[picking.tab].grid[picking.cell] = slot
    closePicker()
  }

  // Turn the picked slot into a move source: the next slot tapped (any tab)
  // swaps contents with it. Tapping the source again backs out.
  function armMove(): void {
    if (!picking) return
    moving = picking
    const slot = tabs[moving.tab].grid[moving.cell]
    moveHint.innerHTML = ''
    moveHint.appendChild(el('span', 'ed-move-hint-text',
      `Moving ${faceLabel(slot)} — tap the key to swap it with.`))
    moveHint.appendChild(button('Cancel', 'set-action', cancelMove))
    closePicker()  // re-renders tabs: the hint takes the picker's place
  }

  function cancelMove(): void {
    moving = null
    renderTabs()
  }

  function buildPicker(): void {
    picker.innerHTML = ''
    if (!picking) return
    const current = tabs[picking.tab].grid[picking.cell]

    // Description line — the tooltip replacement (no title tooltips on iOS).
    // Narrates the current assignment, the text being typed, or an armed
    // special key, whichever the user touched last.
    const info = el('div', 'ed-picker-info')
    const setInfo = (slot: SlotDef | null, suffix = ''): void => {
      info.textContent = slotNarration(slot) + suffix
    }
    setInfo(current)
    picker.appendChild(info)

    // Special keys arm on the first tap (described above) and send on the
    // second — the two-tap confirm the newgame-choice grid uses.
    let armed: HTMLButtonElement | null = null
    function disarm(): void {
      armed?.classList.remove('armed')
      armed = null
    }

    const textRow = el('div', 'ed-picker-textrow')
    const textInput = noAutofix(el('input', 'ed-picker-text settings-input'))
    textInput.maxLength = MAX_MACRO_LEN
    textInput.placeholder = "key(s), e.g. 'o' or 'za.'"
    // Starts empty, never holding the current text: typing after a prefilled
    // "5" made the macro "5o" (the info line names the current assignment).
    const setText = (): void => { if (textInput.value) assign({ text: textInput.value }) }
    textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setText() } })
    textInput.addEventListener('input', () => {
      disarm()
      if (textInput.value) setInfo({ text: textInput.value })
      else setInfo(current)
    })
    textRow.appendChild(textInput)
    textRow.appendChild(button('Set', 'set-action ed-picker-set', setText))
    picker.appendChild(textRow)

    const keys = el('div', 'ed-picker-keys')
    for (const sk of PICKER_KEYS) {
      const kb = button(sk.label, 'ed-key', () => {
        if (armed === kb) {
          assign({ key: sk.keycode })
          return
        }
        disarm()
        armed = kb
        kb.classList.add('armed')
        setInfo({ key: sk.keycode }, ' · tap again to set')
      })
      kb.title = sk.title
      if (current?.key === sk.keycode) kb.classList.add('current')
      keys.appendChild(kb)
    }
    picker.appendChild(keys)

    const foot = el('div', 'ed-picker-foot')
    if (current) foot.appendChild(button('Move', 'set-action', armMove))
    foot.appendChild(button('Clear key', 'set-action', () => assign(null)))
    // "Close", not "Cancel": the editor's own Cancel sits just below
    foot.appendChild(button('Close', 'set-action', closePicker))
    picker.appendChild(foot)
  }

  // What Save stores; its JSON against the opening state is the dirty test.
  function edited(): ControlSet {
    return {
      id: set.id,
      name: nameInput.value.trim() || set.name,
      tabs: tabs.map(tab => ({
        name: tab.name,
        cols: tab.cols,
        slots: cropGrid(tab.grid, tab.cols),
      })) as ControlSet['tabs'],
    }
  }
  const isDirty = (): boolean => JSON.stringify(edited()) !== pristine

  // Leaving by Cancel, Escape or back: asks first when there are edits.
  function leave(): void {
    if (isDirty()) confirmDiscard(() => backHome(body))
    else backHome(body)
  }

  const foot = el('div', 'settings-actions is-pinned')
  foot.appendChild(button('Cancel', 'settings-btn', leave))
  foot.appendChild(button('Save', 'settings-btn settings-btn-primary', () => {
    const saved = edited()
    saveControlSet(saved)
    if (isNew) setActiveControlSet(saved.id)  // you just built it — use it
    backHome(body)
  }))
  body.appendChild(foot)

  renderTabs()
  const pristine = JSON.stringify(edited())
  body.scrollTop = 0
  // Escape/back steps out one level: bubble, then the editor itself. ✕ and
  // the scrim leave Settings outright — after asking, if there are edits.
  pageIntercept = (via) => {
    if (via === 'back') {
      if (picking) closePicker()
      else if (moving) cancelMove()
      else leave()
      return true
    }
    if (!isDirty()) return false
    confirmDiscard(() => closeSettings?.())
    return true
  }
}

// The app's alert, asking before unsaved edits are thrown away. Stacks over
// the Settings sheet as its own overlay, so Escape or a scrim tap keeps
// editing; only Discard runs `onDiscard`.
function confirmDiscard(onDiscard: () => void): void {
  // Focus returns to the control that raised the alert, so a Keep leaves the
  // editor exactly as it was (after a Discard that control goes with the
  // editor). The backdrop is .doc-backdrop: --z-doc, over the sheet.
  const opener = document.activeElement
  const { backdrop, close } = mountBackdrop(undefined, () => {
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
  })
  const card = el('div', 'settings-alert')
  card.setAttribute('role', 'alertdialog')
  card.setAttribute('aria-modal', 'true')
  const title = el('p', 'settings-alert-title', 'Discard changes?')
  title.id = 'settings-alert-title'
  card.setAttribute('aria-labelledby', title.id)
  card.appendChild(title)
  const actions = el('div', 'settings-alert-actions')
  const keep = button('Keep editing', 'settings-alert-btn settings-alert-keep', close)
  actions.appendChild(keep)
  actions.appendChild(button('Discard', 'settings-alert-btn settings-alert-discard', () => {
    close()
    onDiscard()
  }))
  card.appendChild(actions)
  backdrop.appendChild(card)
  keep.focus()
}
