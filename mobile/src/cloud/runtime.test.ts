// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeStorage } from '../test/fake-storage'
import { encodeSnapshot, snapshot } from './snapshot'

const mocks = vi.hoisted(() => ({
  provider: {
    supported: vi.fn(() => true), status: vi.fn(), read: vi.fn(), write: vi.fn(),
    choose: vi.fn(), permit: vi.fn(), disconnect: vi.fn(), cancel: vi.fn(),
  },
  readLocal: vi.fn(), replace: vi.fn(), base: vi.fn(), setBase: vi.fn(), archive: vi.fn(),
}))
vi.mock('./supabase-provider', () => ({ createSupabaseProvider: () => mocks.provider, linkCloudAccount: vi.fn() }))
vi.mock('./store', () => ({ cloudStore: { base: mocks.base, setBase: mocks.setBase, archive: mocks.archive } }))
vi.mock('../offline/save-transfer', async orig => ({
  ...await orig<typeof import('../offline/save-transfer')>(),
  fetchEngineBuild: vi.fn(async () => 'build'), readOfflineFiles: mocks.readLocal, replaceOfflineFiles: mocks.replace,
}))

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubGlobal('localStorage', fakeStorage())
  vi.stubGlobal('caches', { open: async () => ({ match: async () => new Response('build') }) })
  vi.stubGlobal('navigator', { onLine: false, locks: { request: vi.fn(async (_name, _opts, callback) => callback({})) } })
  mocks.provider.status.mockResolvedValue({ key: 'account', label: 'user', allowEmpty: true })
  mocks.provider.read.mockRejectedValue(new Error('offline'))
  mocks.provider.cancel.mockImplementation(() => {})
  mocks.readLocal.mockResolvedValue([])
  mocks.base.mockResolvedValue(null)
  mocks.archive.mockResolvedValue(undefined)
  mocks.setBase.mockResolvedValue(undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('offline-first cloud lifecycle', () => {
  it('starts a game without making a cloud request when offline', async () => {
    const { beginCloudGame, cloud, endCloudGame } = await import('./runtime')
    await beginCloudGame()
    expect(cloud.playing).toBe(true)
    expect(mocks.provider.read).not.toHaveBeenCalled()
    endCloudGame()
  })

  it('still starts when cloud metadata cannot be initialized', async () => {
    mocks.provider.status.mockRejectedValueOnce(new Error('storage unavailable'))
    const { beginCloudGame, cloud, endCloudGame } = await import('./runtime')
    await expect(beginCloudGame()).resolves.toBeUndefined()
    expect(cloud.playing).toBe(true)
    endCloudGame()
  })

  it('cancels a pending cloud request before starting the local engine', async () => {
    let rejectRead: (e: Error) => void = () => {}
    mocks.provider.read.mockImplementation(() => new Promise((_resolve, reject) => { rejectRead = reject }))
    mocks.provider.cancel.mockImplementation(() => rejectRead(new Error('cancelled')))
    const { beginCloudGame, cloud, endCloudGame, syncIdle } = await import('./runtime')
    const syncing = syncIdle().catch(() => {})
    await vi.waitFor(() => expect(mocks.provider.read).toHaveBeenCalled())
    await beginCloudGame()
    await syncing
    expect(cloud.playing).toBe(true)
    expect(mocks.replace).not.toHaveBeenCalled()
    endCloudGame()
  })

  it('blocks importing cloud progress while a game is running', async () => {
    const { beginCloudGame, syncIdle, endCloudGame } = await import('./runtime')
    await beginCloudGame()
    await expect(syncIdle()).rejects.toThrow(/종료/)
    expect(mocks.replace).not.toHaveBeenCalled()
    endCloudGame()
  })

  it('keeps a failed upload from interrupting the running game', async () => {
    vi.useFakeTimers()
    const { beginCloudGame, savedCheckpoint, cloud, endCloudGame } = await import('./runtime')
    await beginCloudGame()
    savedCheckpoint()
    await vi.advanceTimersByTimeAsync(60_000)
    vi.useRealTimers()
    await vi.waitFor(() => expect(cloud.state.phase).toBe('error'))
    expect(cloud.playing).toBe(true)
    expect(cloud.state.phase).toBe('error')
    expect(mocks.replace).not.toHaveBeenCalled()
    endCloudGame()
  })

  it('syncs the final local files after releasing the game lease', async () => {
    const files = [{ path: '/crawl/saves/hero.cs', mode: 0o100664, mtimeMs: 1, data: new Uint8Array([1]) }]
    const remote = await snapshot(files, 'build')
    mocks.readLocal.mockResolvedValue(files)
    mocks.provider.read.mockResolvedValue(encodeSnapshot(remote))
    const { beginCloudGame, endCloudGame, cloud } = await import('./runtime')
    await beginCloudGame()
    endCloudGame()
    await vi.waitFor(() => expect(cloud.state.phase).toBe('ready'))
    expect(cloud.playing).toBe(false)
    expect(mocks.setBase).toHaveBeenCalled()
  })
})
