// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { packSave } from '../offline/save-transfer'

const io = vi.hoisted(() => ({ read: vi.fn(), files: vi.fn(), write: vi.fn(), release: vi.fn(), transfer: vi.fn(),
  signin: vi.fn(), signup: vi.fn(), refresh: vi.fn(), archives: vi.fn(), records: vi.fn(), remove: vi.fn() }))
vi.mock('../offline/save-transfer', async original => ({ ...await original<typeof import('../offline/save-transfer')>(),
  readOfflineFile: io.read, readOfflineFiles: io.files, writeOfflineFiles: io.write }))
vi.mock('../cloud/ownership', () => ({ acquireOfflineOwnership: async () => io.release, recoverOfflineOwnership: vi.fn() }))
vi.mock('../cloud/runtime', () => ({ cloud: { state: { phase: 'ready' } }, transferCloudSaves: io.transfer,
  initializeCloud: vi.fn(), prepareDesktopCloud: vi.fn(), refreshCloudAccount: io.refresh, disconnectCloudAccount: vi.fn(), restoreCloudArchive: vi.fn() }))
vi.mock('../cloud/supabase-provider', () => ({ cloudAccount: () => ({ username: 'Tester' }), signInCloud: io.signin, signUpCloud: io.signup }))
vi.mock('../cloud/store', () => ({ cloudStore: { archives: io.archives } }))
vi.mock('../offline/game-records', () => ({ readGameRecords: io.records, deleteGameRecord: io.remove, sortRecords: (records: unknown[]) => records, readMorgueText: vi.fn() }))
import { desktopAction } from './desktop-actions'

beforeEach(() => {
  vi.clearAllMocks(); io.archives.mockResolvedValue([]); io.records.mockResolvedValue([])
  io.read.mockResolvedValue(new TextEncoder().encode('# Keep this comment\ntravel_delay = -1\n'))
})
describe('native main menu shared actions', () => {
  it('saves all drop fields through the shared RC writer without losing unrelated options', async () => {
    const values = { hns_floor_item_rate: 450, hns_item_quality: 200, hns_item_min_level: 0,
      hns_good_item_chance: 5, hns_randart_chance: 10, hns_gold_amount: 100, hns_consumable_amount: 100 }
    await desktopAction({ id: 1, kind: 'loot-save', values })
    const written = new TextDecoder().decode(io.write.mock.calls[0][0][0].data)
    expect(written).toContain('# Keep this comment\ntravel_delay = -1')
    expect(written).toContain('hns_floor_item_rate = 450')
    expect(io.release).toHaveBeenCalledOnce()
    await expect(desktopAction({ id: 2, kind: 'loot-save', values: { ...values, hns_randart_chance: 101 } })).rejects.toThrow()
    expect(io.write).toHaveBeenCalledOnce()
  })
  it('imports the same validated backup format and does not write malformed backups', async () => {
    const files = [{ path: '/crawl/saves/A.cs', mode: 0o100664, mtimeMs: 1, data: new Uint8Array([1, 2]) }]
    window.HnsDesktop = { importFile: vi.fn(async () => packSave(files, { exportedAt: '' })) } as unknown as Window['HnsDesktop']
    await desktopAction({ id: 3, kind: 'backup-import' })
    expect(io.write).toHaveBeenCalledWith(files)
    window.HnsDesktop!.importFile = vi.fn(async () => new Uint8Array([7]))
    await expect(desktopAction({ id: 4, kind: 'backup-import' })).rejects.toThrow()
    expect(io.write).toHaveBeenCalledOnce()
  })
  it('signs in without copying saves and routes each direction explicitly', async () => {
    await desktopAction({ id: 5, kind: 'cloud-login', values: { username: 'Tester', password: 'secret-password' } })
    expect(io.signin).toHaveBeenCalledWith('Tester', 'secret-password')
    expect(io.write).not.toHaveBeenCalled()
    expect(io.transfer).not.toHaveBeenCalled()
    await desktopAction({ id: 6, kind: 'cloud-upload' })
    expect(io.transfer).toHaveBeenLastCalledWith('upload')
    expect(await desktopAction({ id: 7, kind: 'cloud-download' })).toMatchObject({ reload: true })
    expect(io.transfer).toHaveBeenLastCalledWith('download')
    expect(await desktopAction({ id: 8, kind: 'cloud-status' })).toMatchObject({ account: 'Tester', archives: [] })
  })
  it('rejects a stale record identifier before deleting anything', async () => {
    await expect(desktopAction({ id: 8, kind: 'record-delete', values: { id: 'stale' } })).rejects.toThrow('Record not found')
    expect(io.remove).not.toHaveBeenCalled()
    expect(io.release).toHaveBeenCalledOnce()
  })
})
