import { readDeathRecoveries, type DeathRecovery } from '../offline/death-recovery'
import { restoreDeathRecovery } from '../cloud/runtime'
import { mountCryptShell } from './crypt-view'

export function openDeathRecovery(onRestored: () => void): Promise<void> {
  return new Promise(resolve => {
    let busy = false
    const { view, close } = mountCryptShell('death-recovery-view',
      '<span class="records-morgue-title">사망 캐릭터 복구</span>',
      '<div class="records-list"><p>복구 사본을 확인하고 있습니다…</p></div>', resolve)
    const list = view.querySelector<HTMLElement>('.records-list')!
    void readDeathRecoveries().then(copies => {
      if (!view.isConnected) return
      list.replaceChildren()
      const note = document.createElement('p')
      note.textContent = '부활을 건너뛴 캐릭터를 복구합니다. 캐릭터별 최신 사본을 표시하며, 사망 기록은 유지됩니다.'
      list.append(note)
      if (copies.length === 0) {
        note.textContent = '복구 사본이 없습니다. 앞으로 부활을 건너뛰어도 마지막 층 진입 시점이 보관됩니다. 이전 사망 캐릭터는 남아 있는 자동 백업이 있어야 복구할 수 있습니다.'
      }
      for (const copy of copies) renderCopy(copy)
    }).catch(error => {
      list.textContent = error instanceof Error ? error.message : String(error)
    })

    function renderCopy(copy: DeathRecovery): void {
      const row = document.createElement('div')
      row.className = 'offline-device-row'
      const label = document.createElement('span')
      label.className = 'offline-device-lines'
      const name = document.createElement('strong')
      name.textContent = copy.name
      const details = document.createElement('span')
      details.className = 'offline-device-sub'
      details.textContent = `${new Date(copy.when).toLocaleString()} · ${copy.checkpoint ? '마지막 층 진입 시점' : '이전 자동 백업의 저장 시점'}`
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'offline-device-btn'
      button.textContent = copy.available ? '복구' : '저장 게임 있음'
      button.disabled = !copy.available
      label.append(name, details)
      row.append(label, button)
      list.append(row)
      button.addEventListener('click', () => {
        if (busy) return
        const confirmation = document.createElement('p')
        confirmation.textContent = `${copy.name}의 ${copy.checkpoint ? '마지막 층 진입 시점' : '이전 저장 시점'}으로 돌아갑니다. 다른 캐릭터와 설정은 유지됩니다.`
        const confirm = document.createElement('button')
        confirm.type = 'button'
        confirm.className = 'lobby-btn-primary'
        confirm.textContent = '이 캐릭터 복구'
        row.replaceChildren(confirmation, confirm)
        confirm.focus()
        confirm.addEventListener('click', async () => {
          if (busy) return
          busy = true
          confirm.disabled = true
          confirm.textContent = '복구 중…'
          try {
            await restoreDeathRecovery(copy.id)
            onRestored()
            close()
          } catch (error) {
            confirmation.textContent = error instanceof Error ? error.message : String(error)
            confirm.textContent = '다시 시도'
            confirm.disabled = false
          } finally { busy = false }
        })
      })
    }
  })
}
