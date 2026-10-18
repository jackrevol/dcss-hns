import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { readOfflineFiles, replaceOfflineFiles, unpackSave, packSave, writeOfflineFiles, type SavedFile } from '../offline/save-transfer'

const file = (path: string, n: number): SavedFile => ({ path, mode: 0o100664, mtimeMs: 1, data: new Uint8Array([n]) })
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('cloud local replacement', () => {
  it('removes completed characters, writes new files and preserves engine caches', async () => {
    await writeOfflineFiles([file('/crawl/saves/old.cs', 1), file('/crawl/saves/db/cache', 2)])
    await replaceOfflineFiles([file('/crawl/saves/new.cs', 3)])
    expect((await readOfflineFiles()).map(f => f.path)).toEqual(['/crawl/saves/new.cs'])
    const db = await new Promise<IDBDatabase>(resolve => {
      const req = indexedDB.open('/crawl', 21); req.onsuccess = () => resolve(req.result)
    })
    const cache = await new Promise<unknown>(resolve => {
      const req = db.transaction('FILE_DATA').objectStore('FILE_DATA').get('/crawl/saves/db/cache')
      req.onsuccess = () => resolve(req.result)
    })
    expect(cache).toBeDefined()
    db.close()
  })

  it('rejects file/directory collisions before deleting local progress', async () => {
    await writeOfflineFiles([file('/crawl/saves/old.cs', 1)])
    await expect(replaceOfflineFiles([file('/crawl/saves/foo', 2), file('/crawl/saves/foo/bar', 3)])).rejects.toThrow(/衝突|충돌/)
    expect((await readOfflineFiles()).map(f => f.path)).toEqual(['/crawl/saves/old.cs'])
  })

  it('rolls back deletions if inserting a replacement fails', async () => {
    await writeOfflineFiles([file('/crawl/saves/old.cs', 1)])
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (key === '/crawl/saves/new.cs') throw new DOMException('quota', 'QuotaExceededError')
      return put.call(this, value, key)
    })
    await expect(replaceOfflineFiles([file('/crawl/saves/new.cs', 2)])).rejects.toThrow('quota')
    spy.mockRestore()
    expect((await readOfflineFiles()).map(f => f.path)).toEqual(['/crawl/saves/old.cs'])
  })

  it('rejects directory modes and malformed paths in downloaded packs', () => {
    for (const value of [
      { ...file('/crawl/saves/a.cs', 1), mode: 0o40775 },
      file('/crawl/saves/./a.cs', 1), file('/crawl/saves//a.cs', 1), file('/crawl/saves/a\\b', 1),
    ]) expect(() => unpackSave(packSave([value], { exportedAt: '' }))).toThrow()
  })
})
