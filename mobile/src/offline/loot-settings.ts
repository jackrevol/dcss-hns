export const LOOT_FIELDS = [
  { key: 'hns_floor_item_rate', label: '바닥 아이템 생성량', unit: '배', scale: 100, min: 0, max: 1000, value: 300,
    help: '일반 바닥 아이템의 생성량입니다. 0배로 설정하면 생성하지 않습니다.' },
  { key: 'hns_item_quality', label: '아이템 품질', unit: '배', scale: 100, min: 0, max: 1000, value: 200,
    help: '깊이에 따른 품질 인자를 조절합니다. 강화 수치 자체의 배수는 아닙니다.' },
  { key: 'hns_item_min_level', label: '최소 품질 단계', unit: '단계', scale: 1, min: 0, max: 50, value: 0,
    help: '얕은 층에서도 적용할 최소 품질입니다. 일반 품질 인자의 상한은 50입니다.' },
  { key: 'hns_good_item_chance', label: '우수 아이템 추가 확률', unit: '%', scale: 1, min: 0, max: 100, value: 0,
    help: '일반 품질 대신 우수 아이템 생성 규칙을 적용할 확률입니다.' },
  { key: 'hns_randart_chance', label: '랜덤 아티팩트 추가 확률', unit: '%', scale: 1, min: 0, max: 100, value: 0,
    help: '무기·방어구·장신구·탈리스만의 생성 시도 확률입니다. 아티팩트 불가 종류는 우수 아이템으로 대체하며, 0%에서도 원래 확률은 유지됩니다.' },
  { key: 'hns_gold_amount', label: '골드 묶음 수량', unit: '배', scale: 100, min: 1, max: 1000, value: 100,
    help: '생성되는 골드 한 묶음의 양입니다. 최소 1개를 보장합니다.' },
  { key: 'hns_consumable_amount', label: '소모품 묶음 수량', unit: '배', scale: 100, min: 1, max: 1000, value: 100,
    help: '물약·스크롤·탄약 한 묶음의 개수입니다. 최소 1개를 보장합니다.' },
] as const

export type LootKey = typeof LOOT_FIELDS[number]['key']
export type LootSettings = Record<LootKey, number>
export const defaultLootSettings = (): LootSettings => Object.fromEntries(
  LOOT_FIELDS.map(field => [field.key, field.value])) as LootSettings

const START = '# BEGIN HNS LOOT SETTINGS'
const END = '# END HNS LOOT SETTINGS'

export function parseLootSettings(rc: string): LootSettings {
  const settings = defaultLootSettings()
  let lua = false
  for (const line of rc.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '{' || /^lua\s*=\s*\{/.test(trimmed)) { lua = true; continue }
    if (lua) { if (trimmed === '}') lua = false; continue }
    const match = /^\s*(hns_\w+)\s*=\s*([+-]?\d+)\s*(?:#.*)?$/.exec(line)
    if (!match) continue
    const field = LOOT_FIELDS.find(field => field.key === match[1])
    const value = Number(match[2])
    if (field && Number.isSafeInteger(value) && value >= field.min && value <= field.max) {
      settings[field.key] = value
    }
  }
  return settings
}

export function validateLootSettings(settings: LootSettings): void {
  for (const field of LOOT_FIELDS) {
    const value = settings[field.key]
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      throw new Error(`${field.label}: ${field.min / field.scale}–${field.max / field.scale}${field.unit} 범위로 입력하세요.`)
    }
  }
}

export function writeLootSettings(rc: string, settings: LootSettings): string {
  validateLootSettings(settings)
  // Keep user options, comments and Lua intact. Last assignments win in Crawl.
  // A repeated save replaces only our own managed block.
  const existing = rc.replace(/^# BEGIN HNS LOOT SETTINGS\r?\n[\s\S]*?^# END HNS LOOT SETTINGS(?:\r?\n|$)/gm, '')
  return existing.replace(/\s*$/, '') + (existing.trim() ? '\n\n' : '')
    + START + '\n' + LOOT_FIELDS.map(field => `${field.key} = ${settings[field.key]}`).join('\n')
    + '\n' + END + '\n'
}
