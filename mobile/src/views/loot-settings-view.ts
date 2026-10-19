import { readOfflineFile, writeOfflineFiles } from '../offline/save-transfer'
import { defaultLootSettings, LOOT_FIELDS, parseLootSettings, writeLootSettings } from '../offline/loot-settings'
import { mountCardOverlay } from './overlay'

export async function openLootSettings(onSaved: (notice: string) => void, canEdit: () => boolean = () => true): Promise<void> {
  const bytes = await readOfflineFile('/crawl/init.txt')
  if (!canEdit()) return
  let saving = false
  const rc = bytes ? new TextDecoder().decode(bytes) : ''
  const { body, close } = mountCardOverlay('아이템 드랍 설정', {
    card: 'settings-card', body: 'settings-body hns-loot-settings',
  }, undefined, () => saving)
  const note = document.createElement('p')
  note.className = 'settings-footer'
  note.textContent = '이 기기의 HNS 오프라인 게임 전체에서 공유합니다. 소모품 묶음 수량은 금고·특수방을 포함한 새 바닥 아이템에 적용하며, 나머지 옵션은 일반 랜덤 바닥 아이템에 적용합니다. 저장 후 게임을 시작·재개하면 새로 생성되는 아이템부터 반영됩니다. 기존 아이템과 몬스터의 소지 장비는 유지됩니다.'
  body.appendChild(note)
  const form = document.createElement('form')
  const settings = parseLootSettings(rc)
  const inputs = new Map<string, HTMLInputElement>()
  for (const field of LOOT_FIELDS) {
    const row = document.createElement('label')
    row.className = 'hns-loot-row'
    const text = document.createElement('span')
    text.className = 'hns-loot-label'
    text.textContent = field.label
    const hint = document.createElement('small')
    hint.textContent = field.help
    text.appendChild(hint)
    const input = document.createElement('input')
    input.type = 'number'
    input.inputMode = field.scale === 100 ? 'decimal' : 'numeric'
    input.name = field.key
    input.min = String(field.min / field.scale)
    input.max = String(field.max / field.scale)
    input.step = String(1 / field.scale)
    input.required = true
    input.setAttribute('aria-label', field.label)
    input.value = String(settings[field.key] / field.scale)
    inputs.set(field.key, input)
    const unit = document.createElement('span')
    unit.textContent = field.unit
    row.append(text, input, unit)
    form.appendChild(row)
  }
  const error = document.createElement('p')
  error.className = 'login-error'
  error.setAttribute('role', 'alert')
  error.hidden = true
  const actions = document.createElement('div')
  actions.className = 'hns-loot-actions'
  const buttons: HTMLButtonElement[] = []
  const preset = (label: string, vanilla: boolean): void => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'settings-btn'
    button.textContent = label
    button.addEventListener('click', () => {
      const defaults = defaultLootSettings()
      if (vanilla) { defaults.hns_floor_item_rate = 100; defaults.hns_item_quality = 100 }
      for (const field of LOOT_FIELDS) inputs.get(field.key)!.value = String(defaults[field.key] / field.scale)
      error.hidden = true
    })
    buttons.push(button)
    actions.appendChild(button)
  }
  preset('HNS 기본값', false)
  preset('원본 드랍값', true)
  const save = document.createElement('button')
  save.type = 'submit'
  save.className = 'lobby-btn-primary'
  save.textContent = '저장'
  buttons.push(save)
  actions.appendChild(save)
  form.append(error, actions)
  body.appendChild(form)
  form.addEventListener('submit', event => {
    event.preventDefault()
    try {
      if (!canEdit()) throw new Error('게임을 저장하고 종료한 뒤 설정을 변경하세요.')
      const updated = defaultLootSettings()
      for (const field of LOOT_FIELDS) {
        const value = inputs.get(field.key)!.valueAsNumber * field.scale
        updated[field.key] = Math.abs(value - Math.round(value)) < 1e-6 ? Math.round(value) : NaN
      }
      const data = new TextEncoder().encode(writeLootSettings(rc, updated))
      saving = true
      buttons.forEach(button => { button.disabled = true })
      inputs.forEach(input => { input.disabled = true })
      void writeOfflineFiles([{ path: '/crawl/init.txt', mode: 0o100664, mtimeMs: Date.now(), data }])
        .then(() => { saving = false; close(); onSaved('아이템 드랍 설정을 저장했습니다.') })
        .catch((failure: unknown) => {
          saving = false
          buttons.forEach(button => { button.disabled = false })
          inputs.forEach(input => { input.disabled = false })
          error.hidden = false
          error.textContent = `저장 실패: ${failure instanceof Error ? failure.message : String(failure)}`
        })
    } catch (failure) {
      error.hidden = false
      error.textContent = failure instanceof Error ? failure.message : String(failure)
    }
  })
}
