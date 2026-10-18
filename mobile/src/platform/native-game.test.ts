// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { packSave, type SavedFile } from '../offline/save-transfer'

const io = vi.hoisted(() => ({ read: vi.fn(), replace: vi.fn(), release: vi.fn(), checkpoint: vi.fn() }))
vi.mock('../offline/save-transfer', async original => ({
  ...await original<typeof import('../offline/save-transfer')>(),
  readOfflineFiles: io.read, replaceOfflineFiles: io.replace,
}))
vi.mock('../cloud/ownership', () => ({ acquireOfflineOwnership: async () => io.release }))
vi.mock('../cloud/runtime', () => ({ savedCheckpoint: io.checkpoint }))
import { playDesktopGame, recoverDesktopGame } from './native-game'

const files: SavedFile[] = [{ path: '/crawl/init.txt', mode: 0o100664, mtimeMs: 1,
  data: new TextEncoder().encode('hns_item_quality = 250\n') }]
const packed = () => packSave(files, { exportedAt: '' })
beforeEach(() => { vi.clearAllMocks(); io.read.mockResolvedValue(files); io.replace.mockResolvedValue(undefined) })
afterEach(() => vi.unstubAllGlobals())
describe('PC shared save persistence', () => {
  it('applies native checkpoints and the final deletion before acknowledging, and ignores late checkpoints', async () => {
    let receive!: (bytes: Uint8Array) => void
    let finishGame!: (result: { pack: Uint8Array; code: number; manage: boolean }) => void
    const bridge = { native: true, finish: vi.fn(), onCheckpoint: vi.fn(callback => { receive = callback; return vi.fn() }),
      play: vi.fn(() => new Promise(resolve => { finishGame = resolve })) }
    vi.stubGlobal('window', { HnsDesktop: bridge })
    const pending = playDesktopGame('', () => {})
    await vi.waitFor(() => expect(bridge.play).toHaveBeenCalledOnce())
    receive(packed())
    await vi.waitFor(() => expect(io.checkpoint).toHaveBeenCalledWith(0))
    expect(bridge.finish).not.toHaveBeenCalled()
    finishGame({ pack: packSave([], { exportedAt: '' }), code: 0, manage: true })
    await pending
    expect(io.replace).toHaveBeenLastCalledWith([])
    expect(bridge.finish).toHaveBeenCalledOnce()
    receive(packed())
    await Promise.resolve()
    expect(io.replace).toHaveBeenLastCalledWith([])
  })
  it('keeps native recovery pending if IndexedDB cannot accept the final save', async () => {
    const bridge = { native: true, finish: vi.fn(), onCheckpoint: vi.fn(() => vi.fn()),
      play: vi.fn(async () => ({ pack: packed(), code: 0, manage: true })) }
    vi.stubGlobal('window', { HnsDesktop: bridge })
    io.replace.mockRejectedValue(new Error('quota'))
    await expect(playDesktopGame('', () => {})).rejects.toThrow('quota')
    expect(bridge.finish).not.toHaveBeenCalled()
  })
  it('recovers the native snapshot under the save lock before clearing the recovery marker', async () => {
    const bridge = { native: true, recover: vi.fn(async () => packed()), finish: vi.fn() }
    vi.stubGlobal('window', { HnsDesktop: bridge })
    await recoverDesktopGame()
    expect(io.replace).toHaveBeenCalledWith(files)
    expect(bridge.finish).toHaveBeenCalledOnce()
    expect(io.release).toHaveBeenCalledOnce()
  })
})
