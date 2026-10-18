import { describe, expect, it } from 'vitest'
import { defaultLootSettings, LOOT_FIELDS, parseLootSettings, writeLootSettings } from './loot-settings'

describe('HNS loot settings RC file', () => {
  it('keeps the existing HNS floor loot defaults', () => {
    const settings = parseLootSettings('')
    expect(settings.hns_floor_item_rate).toBe(300)
    expect(settings.hns_item_quality).toBe(200)
  })

  it('reads the last valid assignment and ignores comments and Lua blocks', () => {
    const settings = parseLootSettings('hns_floor_item_rate = 150\n# hns_floor_item_rate = 0\n{\nhns_floor_item_rate = 500\n}\nhns_floor_item_rate = 250 # chosen\nhns_floor_item_rate = -1\n')
    expect(settings.hns_floor_item_rate).toBe(250)
  })

  it('round-trips every setting and preserves unrelated options and Lua', () => {
    const rc = '# My character\ndefault_manual_training = true\n{\ncrawl.mpr("hello")\n}\n'
    const settings = defaultLootSettings()
    for (const field of LOOT_FIELDS) settings[field.key] = field.max
    const output = writeLootSettings(rc, settings)
    expect(output).toContain(rc.trim())
    expect(parseLootSettings(output)).toEqual(settings)
  })

  it('replaces its own block without accumulating settings on repeated saves', () => {
    const first = writeLootSettings('hns_floor_item_rate = 100\n', defaultLootSettings())
    const updated = { ...defaultLootSettings(), hns_floor_item_rate: 0 }
    const second = writeLootSettings(first, updated)
    expect(second.match(/# BEGIN HNS LOOT SETTINGS/g)).toHaveLength(1)
    expect(second).toContain('hns_floor_item_rate = 100')
    expect(parseLootSettings(second).hns_floor_item_rate).toBe(0)
  })

  it.each(LOOT_FIELDS)('rejects invalid $key values before touching storage', field => {
    for (const value of [field.min - 1, field.max + 1, NaN, Infinity, 1.5]) {
      expect(() => writeLootSettings('', { ...defaultLootSettings(), [field.key]: value })).toThrow()
    }
  })
})
