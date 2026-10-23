import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { cloudStore, type Archive } from '../cloud/store'
import { snapshot } from '../cloud/snapshot'
import { findDeathRecoveries, readDeathRecoveries, restoreDeathRecoveryFile } from './death-recovery'
import { readOfflineFiles, writeOfflineFiles, type SavedFile } from './save-transfer'

const data = (value: string) => new TextEncoder().encode(value)
const save = (path: string, value = 'DCSS............alive', when = 1000): SavedFile =>
  ({ path, data: data(value), mtimeMs: when, mode: 0o100664 })
const copy = (name = 'Hero', when = 2000): SavedFile[] => [
  save(`/crawl/saves/recovery/${name}.cs`),
  save(`/crawl/saves/recovery/${name}.json`, JSON.stringify({ name, when, checkpoint: true })),
]
const archive = async (id: string, files: SavedFile[]): Promise<Archive> =>
  ({ id, when: 10_000, reason: 'old backup', snapshot: await snapshot(files) })

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => vi.unstubAllGlobals())

describe('death recovery', () => {
  it('restores only the selected character and keeps its recovery copy and death history', async () => {
    const files = [...copy(), save('/crawl/saves/Other.cs'), save('/crawl/init.txt', 'options'),
      save('/crawl/saves/logfile', 'death record')]
    await writeOfflineFiles(files)
    const entries = await readDeathRecoveries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'Hero', checkpoint: true, available: true })
    await restoreDeathRecoveryFile(entries[0].id)
    const restored = await readOfflineFiles()
    for (const file of files) expect(restored.find(f => f.path === file.path)?.data).toEqual(file.data)
    expect(restored.find(f => f.path === '/crawl/saves/Hero.cs')?.data).toEqual(files[0].data)
  })

  it('offers the latest saved character from old automatic backups without restoring the whole profile', async () => {
    await cloudStore.archive('old', await snapshot([save('/crawl/saves/Old.cs'), save('/crawl/init.txt', 'old options')]))
    await writeOfflineFiles([save('/crawl/init.txt', 'current options')])
    const [entry] = await readDeathRecoveries()
    expect(entry).toMatchObject({ name: 'Old', checkpoint: false, when: 1000 })
    await restoreDeathRecoveryFile(entry.id)
    expect((await readOfflineFiles()).find(f => f.path === '/crawl/init.txt')?.data).toEqual(data('current options'))
  })

  it('never overwrites a live game, including concurrent recovery attempts', async () => {
    await writeOfflineFiles(copy())
    const [entry] = await readDeathRecoveries()
    const results = await Promise.allSettled([restoreDeathRecoveryFile(entry.id), restoreDeathRecoveryFile(entry.id)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    await writeOfflineFiles([save('/crawl/saves/Hero.cs', 'DCSS............new progress')])
    await expect(restoreDeathRecoveryFile(entry.id)).rejects.toThrow(/이미|덮어쓰지/)
    expect((await readOfflineFiles()).find(f => f.path === '/crawl/saves/Hero.cs')?.data).toEqual(data('DCSS............new progress'))
    expect((await readDeathRecoveries())[0].available).toBe(false)
  })

  it('deduplicates by actual save time and ignores corrupt, missing and unsafe copies', async () => {
    const old = await archive('older', [save('/crawl/saves/Hero.cs', undefined, 500)])
    const newer = await archive('newer', [save('/crawl/saves/Hero.cs', undefined, 1500)])
    const files = [...copy(), ...copy('Broken'),
      save('/crawl/saves/recovery/Bad.json', '{'),
      save('/crawl/saves/recovery/Missing.json', JSON.stringify({ name: 'Missing', when: 1, checkpoint: true }))]
    files.find(f => f.path.endsWith('Broken.cs'))!.data = data('corrupt')
    const unsafe = await archive('unsafe', [save('/crawl/saves/../outside.cs')])
    const entries = findDeathRecoveries(files, [newer, old, unsafe])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'Hero', checkpoint: true, when: 2000 })
    expect(findDeathRecoveries([], [old, newer])[0].id).toContain('newer')
    await expect(restoreDeathRecoveryFile('checkpoint:../../outside')).rejects.toThrow(/찾지/)
  })
})
