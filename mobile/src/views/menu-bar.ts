// The menu-controls bar (#menu-controls): the bottom button row that stands
// in for the touch panel under menus with keys of their own, the skills CRT,
// a YESNO prompt inside a menu, and the creation screens. The game view owns
// when it shows (setMenuBar there, which also sets the layout's view class);
// this owns what it holds.

import type { ClientMsg } from '../ws/types'
import type { ShiftToggle } from '../game/input/shift-state'
import { bindPressedClass } from '../game/input/touch'
import { escHtml } from '../game/dcss-colors'
import { MF_ALLOW_FILTER, MF_MULTISELECT } from '../game/menu-model'
import { primeSystemKeyboard } from './text-field'

// Menus whose tag earns a permanent bottom control bar (shown on open,
// kept under layered ui-pushes, rebuilt across input-mode changes). Every
// tag here needs a matching branch in MenuBar.build.
export function menuTagHasBar(tag: string | undefined): boolean {
  return tag === 'shop' || tag === 'stash' || tag === 'acquirement'
    || tag === 'ability' || tag === 'spell'
}

function glyphHtml(label: string): string {
  if (label === '⎋' || label === '⏎') return `<span class="menu-ctrl-glyph">${label}</span>`
  if (label.startsWith('⏎ ')) return `<span class="menu-ctrl-glyph">⏎</span> ${escHtml(label.slice(2))}`
  if (label.startsWith('⎋ ')) return `<span class="menu-ctrl-glyph">⎋</span> ${escHtml(label.slice(2))}`
  return escHtml(label)
}

export interface MenuBarDeps {
  send(msg: ClientMsg): void
  focusView(): void
  shift: ShiftToggle
  // A (y/N) prompt is reading inside the open menu (input_mode YESNO).
  yesno(): boolean
}

export class MenuBar {
  readonly element = document.createElement('div')
  private readonly deps: MenuBarDeps

  constructor(deps: MenuBarDeps) {
    this.deps = deps
    this.element.id = 'menu-controls'
  }

  clear(): void {
    this.element.innerHTML = ''
  }

  // The button row for a menu tag (or the bare ⎋ with none).
  build(tag?: string, flags?: number): void {
    this.clear()
    // opensField: the key always opens a free-text field (primeSystemKeyboard).
    type BtnDef = {
      label: string; key?: string; keycode?: number; dynamic?: true; shift?: true; opensField?: true
    }
    // Server keeps the menu open for a (y/N) confirmation (e.g. shop purchase)
    // and signals it via input_mode=YESNO. Swap the row to Y/N so the user
    // has a way to answer without a keyboard.
    let btns: BtnDef[]
    if (this.deps.yesno()) {
      btns = [
        { label: '⎋', keycode: 27 },
        { label: 'Y', key: 'y' },
        { label: 'N', key: 'n' },
      ]
    } else if (tag === 'shop') {
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '!', key: '!' },
        { label: '⇧', shift: true },
        { label: '/', key: '/' },
        { label: '⏎', keycode: 13, dynamic: true },
      ]
    } else if (tag === 'acquirement') {
      // AcquireMenu (acquire.cc): single-select, item hotkeys a-i via row taps.
      // ! cycles acquire/examine mode; selecting an item flips input_mode to
      // YESNO, which the yesno branch above swaps in for confirmation.
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '!', key: '!' },
      ]
    } else if (tag === 'stash') {
      // Stash-search results (Ctrl-F). Tap a row to open the X-mode preview;
      // the game view's applyLayout hides/restores this menu around the
      // preview. The three letter-keys mirror the cues the server prints
      // in the menu title:
      //   !  toggle travel/examine target mode
      //   =  hide useless & duplicates
      //   /  cycle sort (alpha / by distance)
      // No accept (⏎) button: with no visible default hover (see MenuModel
      // hoverFromUser) there's no obvious target, and tapping a row already
      // activates it.
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '!', key: '!' },
        { label: '=', key: '=' },
        { label: '/', key: '/' },
      ]
    } else if (tag === 'ability') {
      // ToggleableMenu with MF_TOGGLE_ACTION (ability.cc choose_ability_menu):
      // ? (also ! and _, via add_toggle_from_command) flips every row and the
      // title between "do what?" and "describe what?" — there is no separate
      // help screen. It's the only extra key the menu has and the only one
      // its footer advertises; row taps act/describe per the current mode.
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '?', key: '?' },
      ]
    } else if (tag === 'spell') {
      // SpellMenu (spl-cast.cc list_spells): ! toggles each row's columns
      // (base school/fail/level ↔ extra stats). No ?: it describes the
      // HOVERED spell (SpellMenu::process_command → examine_index), and a
      // row tap is the only hover mover here — which already selected the
      // row (describe in the `I` menu, cast in the `z` one).
      // The M menu shares the tag (SpellLibraryMenu, spl-book.cc) and is
      // the one carrying MF_ALLOW_FILTER — the flag is how we tell it
      // apart. Its footer offers [Ctrl-F] search, which this bar is the
      // only touch path to (it replaces the strip whose keyboard has Ctrl),
      // and [?] help: its get_command maps ? to show_spell_library_help,
      // a help screen rather than a describe. The search prompt is
      // menu-view's filter; ⎋ while a search is applied clears it rather
      // than closing.
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '!', key: '!' },
      ]
      if (flags !== undefined && (flags & MF_ALLOW_FILTER)) {
        btns.push({ label: '⌃F', keycode: 6, opensField: true }, { label: '?', key: '?' })
      }
    } else if (tag === 'skills') {
      // Key roles (skill-menu.cc init_switches / init_help): ! = train
      // mode switch, * = show all skills, - = clear targets (a visible
      // no-op until some skill has a target set), _ = level/progress
      // display, = = set target, / = auto/manual, ? = help. ⇧ lives in
      // the letter keyboard (setSkillLetters).
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '!',   key: '!' },
        { label: '*',   key: '*' },
        { label: '-',   key: '-' },
        { label: '_',   key: '_' },
        { label: '=',   key: '=' },
        { label: '/',   key: '/' },
        { label: '?',   key: '?' },
      ]
    } else if (flags !== undefined && (flags & MF_MULTISELECT)) {
      btns = [
        { label: '⎋', keycode: 27 },
        { label: '⏎', keycode: 13, dynamic: true },
      ]
    } else {
      btns = [{ label: '⎋', keycode: 27 }]
    }
    for (const def of btns) {
      const fire = def.shift
        ? () => this.deps.shift.tap()
        : () => {
            if (def.key) this.deps.send({ msg: 'input', text: def.key })
            else if (def.keycode) this.deps.send({ msg: 'key', keycode: def.keycode })
          }
      const btn = this.button(def.label, fire, def.opensField)
      if (def.dynamic) btn.dataset.dynamic = 'accept'
      if (def.shift) {
        btn.dataset.shift = 'true'
        this.applyShiftBtnState(btn)
      }
      this.element.appendChild(btn)
    }
  }

  // One bar button: fires on touchstart (preventDefault suppresses the
  // synthesized click, so phones respond instantly without double-firing)
  // with click as the mouse path — the only one that re-focuses the view.
  // Every bar button goes through here so the tap feel can't drift. Only
  // the touch path primes: a mouse's click focuses the field directly.
  private button(label: string, fire: () => void, opensField = false): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'menu-ctrl-btn'
    btn.innerHTML = glyphHtml(label)
    btn.addEventListener('click', () => {
      fire()
      this.deps.focusView()
    })
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (opensField) primeSystemKeyboard()
      fire()
    }, { passive: false })
    bindPressedClass(btn)
    return btn
  }

  // The ⏎ button's label, parsed from the menu's footer text.
  syncAccept(footerText: string): void {
    const btn = this.element.querySelector<HTMLButtonElement>('[data-dynamic="accept"]')
    if (!btn) return
    const acceptMatch = footerText.match(/accept\s*(\(\d+ chosen\))/i)
    // Shop (shopping.cc ShopMenu::update_help): the [Enter] slot cycles
    // blank / describe / "buy shopping list" / "buy marked items". Keep the
    // labels a word or two — the bar has five buttons across the phone
    // width (see the accept rule in style.css).
    const buyMatch = footerText.match(/\[Enter\]\s+buy\s+(marked\s+items|shopping\s+list)/i)
    if (acceptMatch) btn.innerHTML = glyphHtml(`⏎ Accept ${acceptMatch[1]}`)
    else if (buyMatch) btn.innerHTML = glyphHtml(/list/i.test(buyMatch[1]) ? '⏎ Buy list' : '⏎ Buy')
    else btn.innerHTML = glyphHtml('⏎')
  }

  // The skills CRT's keyboard above the fixed buttons: the virtual
  // keyboard's QWERTY shape, a key lit for each hotkey the screen shows and
  // dimmed for the rest. Hotkeys run a–z, then 0–9 (menu.h menu_letter2),
  // so the number row appears only once the list reaches a digit (27+
  // selectable skills: `*` all skills, `?` help). ⇧ sits left of z as on
  // the virtual keyboard; with no hotkey at all (distributed training, or
  // before the rows land) there's no keyboard and no ⇧ — nothing to shift.
  setSkillLetters(letters: string[]): void {
    this.element.querySelector('.skill-kbd')?.remove()
    if (!letters.length) return
    const lit = new Set(letters)
    const rows = [[...'qwertyuiop'], [...'asdfghjkl'], ['⇧', ...'zxcvbnm', '']]
    if (letters.some(c => c >= '0' && c <= '9')) rows.unshift([...'1234567890'])
    const kbd = document.createElement('div')
    kbd.className = 'skill-kbd'
    for (const keys of rows) {
      const row = document.createElement('div')
      row.className = 'skill-kbd-row'
      for (const k of keys) row.appendChild(this.skillKey(k, lit))
      kbd.appendChild(row)
    }
    this.element.insertBefore(kbd, this.element.firstChild)
  }

  private skillKey(k: string, lit: Set<string>): HTMLElement {
    const shift = this.deps.shift
    if (k === '⇧') {
      const btn = this.button(k, () => shift.tap())
      btn.dataset.shift = 'true'
      btn.classList.add('skill-kbd-wide')
      this.applyShiftBtnState(btn)
      return btn
    }
    const cased = () => (shift.isOn ? k.toUpperCase() : k)
    if (!lit.has(k)) {
      // A span, not a disabled button: no tap, no press state. The empty
      // key is the spacer that balances ⇧.
      const off = document.createElement('span')
      off.className = k ? 'skill-key skill-key-off' : 'skill-kbd-wide'
      off.textContent = cased()
      off.setAttribute('aria-hidden', 'true')
      return off
    }
    const btn = this.button(cased(), () => {
      this.deps.send({ msg: 'input', text: cased() })
      shift.consume()
    })
    btn.classList.add('skill-key')
    return btn
  }

  // The shift toggle changed: its ⇧ button's state and the letter labels.
  refreshShift(): void {
    const btn = this.element.querySelector<HTMLElement>('[data-shift="true"]')
    if (btn) this.applyShiftBtnState(btn)
    this.syncShiftLabels()
  }

  // The skill keyboard's faces echo the shift state so what the user sees
  // matches what tapping will send. In shops the ⇧ control's own
  // active/locked styling is the shift indicator.
  private syncShiftLabels(): void {
    const shiftOn = this.deps.shift.isOn
    this.element.querySelectorAll<HTMLElement>('.skill-key').forEach(el => {
      const t = el.textContent ?? ''
      el.textContent = shiftOn ? t.toUpperCase() : t.toLowerCase()
    })
  }

  private applyShiftBtnState(btn: HTMLElement): void {
    const state = this.deps.shift.state
    btn.classList.toggle('active', state === 'once')
    btn.classList.toggle('locked', state === 'lock')
  }
}
