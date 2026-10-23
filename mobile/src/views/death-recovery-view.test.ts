// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDeathRecoveries } from '../offline/death-recovery'
import { restoreDeathRecovery } from '../cloud/runtime'
import { openDeathRecovery } from './death-recovery-view'

vi.mock('../offline/death-recovery', () => ({ readDeathRecoveries: vi.fn() }))
vi.mock('../cloud/runtime', () => ({ restoreDeathRecovery: vi.fn() }))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks() })

describe('death recovery screen', () => {
  it('requires a character-specific confirmation and refreshes the lobby after success', async () => {
    vi.mocked(readDeathRecoveries).mockResolvedValue([{ id: 'copy', name: 'Hero', when: 1000,
      checkpoint: true, available: true, file: {} as never }])
    vi.mocked(restoreDeathRecovery).mockResolvedValue(undefined)
    const refreshed = vi.fn()
    const closed = openDeathRecovery(refreshed)
    await settle()
    document.querySelector<HTMLButtonElement>('.death-recovery-view .offline-device-btn')!.click()
    expect(restoreDeathRecovery).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('다른 캐릭터와 설정은 유지')
    document.querySelector<HTMLButtonElement>('.death-recovery-view .lobby-btn-primary')!.click()
    await closed
    expect(restoreDeathRecovery).toHaveBeenCalledExactlyOnceWith('copy')
    expect(refreshed).toHaveBeenCalledOnce()
  })

  it('explains unavailable old characters and disables copies with existing saves', async () => {
    vi.mocked(readDeathRecoveries).mockResolvedValue([])
    void openDeathRecovery(vi.fn())
    await settle()
    expect(document.body.textContent).toContain('남아 있는 자동 백업')
    document.querySelector<HTMLButtonElement>('.crypt-back')!.click()
    vi.mocked(readDeathRecoveries).mockResolvedValue([{ id: 'copy', name: 'Hero', when: 1000,
      checkpoint: false, available: false, file: {} as never }])
    void openDeathRecovery(vi.fn())
    await settle()
    expect(document.querySelector<HTMLButtonElement>('.offline-device-btn')!.disabled).toBe(true)
    expect(document.body.textContent).toContain('이전 자동 백업의 저장 시점')
  })
})
