// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { primeSystemKeyboard, systemKeyboardField } from './text-field'

function typed(input: HTMLInputElement, value: string, caret = value.length, composing = false): void {
  input.value = value
  input.setSelectionRange(caret, caret)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }))
}

describe('systemKeyboardField', () => {
  // A field left focused by an earlier test would hold off every prime.
  beforeEach(() => { (document.activeElement as HTMLElement | null)?.blur() })

  it('turns smart punctuation back into ASCII, keeping the caret after the same text', () => {
    const input = systemKeyboardField('f')
    document.body.appendChild(input)
    typed(input, 'a—b…c', 2)  // caret after the em dash
    expect(input.value).toBe('a--b...c')
    expect(input.selectionStart).toBe(3)
  })

  it('clamps an expansion to maxlength', () => {
    const input = systemKeyboardField('f')
    input.maxLength = 4
    typed(input, 'ab…')
    expect(input.value).toBe('ab..')
  })

  it('leaves the value alone mid-composition and rewrites on compositionend', () => {
    const input = systemKeyboardField('f')
    const echoed: string[] = []
    input.addEventListener('input', () => echoed.push(input.value))
    typed(input, '“x', 2, true)
    expect(input.value).toBe('“x')
    input.dispatchEvent(new Event('compositionend'))
    expect(input.value).toBe('"x')
    expect(echoed).toEqual(['“x', '"x'])
  })

  it('a touch screen shows "tap to type" until the field itself is tapped, focus or not', () => {
    const coarse = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const input = systemKeyboardField('f')
    document.body.appendChild(input)
    input.focus()
    expect(input.placeholder).toBe('tap to type')
    input.dispatchEvent(new Event('pointerdown'))
    expect(input.placeholder).toBe('')
    coarse.mockReturnValue({ matches: false } as MediaQueryList)
    expect(systemKeyboardField('f').placeholder).toBe('')
    coarse.mockRestore()
  })

  it('a field focused from the primed stand-in drops "tap to type"', () => {
    const coarse = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    primeSystemKeyboard()
    const input = systemKeyboardField('f')
    document.body.appendChild(input)
    expect(input.placeholder).toBe('tap to type')
    input.focus()
    expect(input.placeholder).toBe('')
    input.remove()
    coarse.mockRestore()
  })

  it('text typed into the stand-in before the field arrives moves into the field', () => {
    primeSystemKeyboard()
    const standIn = document.activeElement as HTMLInputElement
    standIn.value = 'ring'
    const input = systemKeyboardField('f')
    input.value = 'a '
    const echoed: string[] = []
    input.addEventListener('input', () => echoed.push(input.value))
    document.body.appendChild(input)
    input.focus()
    expect(input.value).toBe('a ring')
    expect(echoed).toEqual(['a ring'])
    expect(standIn.value).toBe('')
    input.remove()
  })

  it('never takes the focus from a field that already has it', () => {
    const chat = document.createElement('input')
    document.body.appendChild(chat)
    chat.focus()
    primeSystemKeyboard()
    expect(document.activeElement).toBe(chat)
    chat.remove()
  })

  it('does nothing on Android', () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 15)')
    primeSystemKeyboard()
    expect((document.activeElement as HTMLElement | null)?.className).not.toBe('keyboard-stand-in')
    ua.mockRestore()
  })

  it('the stand-in gives the keyboard back when no field arrives', () => {
    vi.useFakeTimers()
    primeSystemKeyboard()
    const standIn = document.activeElement as HTMLElement
    expect(standIn.className).toBe('keyboard-stand-in')
    vi.advanceTimersByTime(1999)
    expect(document.activeElement).toBe(standIn)
    vi.advanceTimersByTime(1)
    expect(document.activeElement).not.toBe(standIn)
    vi.useRealTimers()
  })

  it('an IME-confirming Enter reaches no later handler', () => {
    const input = systemKeyboardField('f')
    const seen: string[] = []
    input.addEventListener('keydown', e => seen.push(e.key))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(seen).toEqual(['Enter'])
  })
})
