// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { createShiftToggle } from '../game/input/shift-state'
import { MenuBar } from './menu-bar'

import type { ClientMsg } from '../ws/types'

function setup() {
  const sent: ClientMsg[] = []
  const shift = createShiftToggle({ onChange: () => bar.refreshShift() })
  const bar = new MenuBar({ send: m => sent.push(m), focusView() {}, shift, yesno: () => false })
  bar.build('skills')
  return { bar, sent, shift }
}

const faces = (els: Iterable<Element>) => [...els].map(e => e.textContent)
const liveKeys = (bar: MenuBar) => faces(bar.element.querySelectorAll('.skill-kbd .menu-ctrl-btn'))
const rows = (bar: MenuBar) => bar.element.querySelectorAll('.skill-kbd-row')
const key = (bar: MenuBar, face: string) =>
  [...bar.element.querySelectorAll<HTMLElement>('.skill-kbd .menu-ctrl-btn')].find(b => b.textContent === face)!

describe('skills letter keyboard', () => {
  it('lights the hotkeys in QWERTY places, ⇧ left of z, above the fixed row', () => {
    const { bar } = setup()
    bar.setSkillLetters([...'abcdefgh'])
    expect(rows(bar)).toHaveLength(3)
    expect(liveKeys(bar)).toEqual(['e', 'a', 'd', 'f', 'g', 'h', '⇧', 'c', 'b'])
    expect(bar.element.querySelectorAll('.skill-key-off')).toHaveLength(26 - 8)
    expect(bar.element.firstElementChild?.className).toBe('skill-kbd')
    expect(faces(bar.element.querySelectorAll(':scope > .menu-ctrl-btn')))
      .toEqual(['⎋', '!', '*', '-', '_', '=', '/', '?'])
  })

  it('adds the number row only once a digit hotkey is in use', () => {
    const { bar } = setup()
    bar.setSkillLetters([...'abcdefghijklmnopqrstuvwxyz012'])
    expect(rows(bar)).toHaveLength(4)
    expect(faces(rows(bar)[0].querySelectorAll('.menu-ctrl-btn'))).toEqual(['1', '2', '0'])
  })

  it('has no keyboard and no ⇧ without hotkeys', () => {
    const { bar } = setup()
    bar.setSkillLetters([...'abc'])
    bar.setSkillLetters([])
    expect(bar.element.querySelector('.skill-kbd')).toBeNull()
    expect(bar.element.querySelector('[data-shift]')).toBeNull()
  })

  it('re-renders in place', () => {
    const { bar } = setup()
    bar.setSkillLetters([...'abc'])
    bar.setSkillLetters([...'ab'])
    expect(bar.element.querySelectorAll('.skill-kbd')).toHaveLength(1)
    expect(liveKeys(bar)).toEqual(['a', '⇧', 'b'])
  })

  it('sends the key; ⇧ capitalises every face and the next send', () => {
    const { bar, sent } = setup()
    bar.setSkillLetters([...'abcd'])
    key(bar, 'd').click()
    key(bar, '⇧').click()
    expect(liveKeys(bar)).toEqual(['A', 'D', '⇧', 'C', 'B'])
    expect(faces(bar.element.querySelectorAll('.skill-key-off'))).toContain('Q')
    key(bar, 'D').click()
    expect(sent).toEqual([{ msg: 'input', text: 'd' }, { msg: 'input', text: 'D' }])
    expect(liveKeys(bar)).toEqual(['a', 'd', '⇧', 'c', 'b'])
  })

  it('a shift lock stays uppercase across sends', () => {
    const { bar, sent } = setup()
    bar.setSkillLetters([...'ab'])
    key(bar, '⇧').click()
    key(bar, '⇧').click()
    key(bar, 'A').click()
    key(bar, 'B').click()
    expect(sent).toEqual([{ msg: 'input', text: 'A' }, { msg: 'input', text: 'B' }])
    expect(liveKeys(bar)).toEqual(['A', '⇧', 'B'])
  })

  // `*` or `/` with ⇧ on brings a txt that rebuilds the keyboard.
  it('a re-render keeps ⇧ on', () => {
    const { bar } = setup()
    bar.setSkillLetters([...'ab'])
    key(bar, '⇧').click()
    bar.setSkillLetters([...'abc'])
    expect(liveKeys(bar)).toEqual(['A', '⇧', 'C', 'B'])
    expect(key(bar, '⇧').classList.contains('active')).toBe(true)
  })

  it('dimmed keys take no tap', () => {
    const { bar, sent } = setup()
    bar.setSkillLetters([...'ab'])
    const q = [...bar.element.querySelectorAll<HTMLElement>('.skill-key-off')].find(e => e.textContent === 'q')!
    q.click()
    expect(q.tagName).toBe('SPAN')
    expect(sent).toEqual([])
  })
})
