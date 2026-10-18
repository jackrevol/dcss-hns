// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { acquireOfflineOwnership, recoverOfflineOwnership } from './ownership'
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('navigator', {})
})
afterEach(() => vi.unstubAllGlobals())
it('allows syncing without Web Locks and serializes concurrent tabs', async () => {
  const first = await acquireOfflineOwnership()
  await expect(acquireOfflineOwnership()).rejects.toThrow(/잠금/)
  await first()
  const next = await acquireOfflineOwnership()
  await next()
})
it('does not steal a suspended game lock; supports explicit crash recovery', async () => {
  const oldRelease = await acquireOfflineOwnership()
  await expect(acquireOfflineOwnership()).rejects.toThrow()
  await recoverOfflineOwnership()
  const currentRelease = await acquireOfflineOwnership()
  await oldRelease()
  await expect(acquireOfflineOwnership()).rejects.toThrow()
  await currentRelease()
})
