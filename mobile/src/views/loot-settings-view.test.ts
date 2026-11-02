// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedFile } from '../offline/save-transfer'
import { parseLootSettings } from '../offline/loot-settings'

const read = vi.fn<() => Promise<Uint8Array | null>>()
const write = vi.fn<(files: SavedFile[]) => Promise<number>>()
vi.mock('../offline/save-transfer', () => ({
  readOfflineFile: () => read(), writeOfflineFiles: (files: SavedFile[]) => write(files),
}))
import { openLootSettings } from './loot-settings-view'

beforeEach(() => { vi.clearAllMocks(); read.mockResolvedValue(null); write.mockResolvedValue(1) })
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  document.body.replaceChildren()
})
const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
const submit = () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

describe('loot settings panel', () => {
  it('saves multipliers as percent options without losing the RC file', async () => {
    read.mockResolvedValue(new TextEncoder().encode('default_manual_training = true\n'))
    const saved = vi.fn()
    await openLootSettings(saved)
    input('hns_floor_item_rate').value = '2.5'
    input('hns_item_min_level').value = '20'
    input('hns_experience_rate').value = '2.75'
    submit()
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce())
    const rc = new TextDecoder().decode(write.mock.calls[0][0][0].data)
    expect(rc).toContain('default_manual_training = true')
    expect(parseLootSettings(rc).hns_floor_item_rate).toBe(250)
    expect(parseLootSettings(rc).hns_item_min_level).toBe(20)
    expect(parseLootSettings(rc).hns_experience_rate).toBe(275)
  })

  it('loads saved XP rates and both presets restore 1x experience', async () => {
    read.mockResolvedValue(new TextEncoder().encode('hns_experience_rate = 250\n'))
    await openLootSettings(vi.fn())
    expect(input('hns_experience_rate').value).toBe('2.5')
    for (const label of ['HNS 기본값', '원본 기본값']) {
      input('hns_experience_rate').value = '0'
      Array.from(document.querySelectorAll('button')).find(button => button.textContent === label)!.click()
      expect(input('hns_experience_rate').value).toBe('1')
    }
  })

  it('allows disabling experience gain', async () => {
    await openLootSettings(vi.fn())
    input('hns_experience_rate').value = '0'
    submit()
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(parseLootSettings(new TextDecoder().decode(write.mock.calls[0][0][0].data)).hns_experience_rate).toBe(0)
  })

  it('discards changes with Escape', async () => {
    await openLootSettings(vi.fn())
    input('hns_floor_item_rate').value = '0'
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(write).not.toHaveBeenCalled()
    expect(document.querySelector('.hns-loot-settings')).toBeNull()
  })

  it('keeps the form open with entered values when saving fails', async () => {
    write.mockRejectedValue(new Error('quota exceeded'))
    await openLootSettings(vi.fn())
    input('hns_floor_item_rate').value = '2.5'
    submit()
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('quota exceeded'))
    expect(input('hns_floor_item_rate').disabled).toBe(false)
    expect(input('hns_floor_item_rate').value).toBe('2.5')
  })

  it('refuses to write if a game started while the options were loading', async () => {
    await openLootSettings(vi.fn(), () => false)
    expect(document.querySelector('.hns-loot-settings')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })
})
