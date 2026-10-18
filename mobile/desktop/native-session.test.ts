// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { spawn } from 'node:child_process'
import { createNativeSession } from './native-session'
import { packSave, unpackSave } from '../src/offline/save-transfer'

const homes: string[] = []
afterEach(() => { vi.useRealTimers(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'hns-native-session-')); homes.push(home)
  const assets = join(home, 'assets'); mkdirSync(assets)
  writeFileSync(join(assets, 'desktop.json'), JSON.stringify({ binary: 'crawl', data: '.', platform: 'win32' }), 'utf8')
  const child = new EventEmitter()
  const launch = vi.fn(() => child)
  const session = createNativeSession(join(home, 'state'), assets, launch as unknown as typeof spawn)
  const files = [
    { path: '/crawl/init.txt', mode: 0o100664, mtimeMs: 1, data: new TextEncoder().encode('hns_floor_item_rate = 500\n') },
    { path: '/crawl/saves/Tester.cs', mode: 0o100664, mtimeMs: 1, data: new Uint8Array([1, 2, 3]) },
  ]
  return { home: join(home, 'state'), child, launch, session, files, bytes: packSave(files, { exportedAt: '' }) }
}
describe('original PC client save bridge', () => {
  it('keeps the original startup menu and round-trips shared drop settings and checkpoints', async () => {
    vi.useFakeTimers()
    const f = fixture(), saved = vi.fn()
    const result = f.session.play('', f.bytes, saved)
    const call = f.launch.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }]
    expect(call[1]).not.toContain('-name')
    expect(call[1].join(' ')).not.toContain('restart_after_save=false')
    expect(f.session.running).toBe(true)
    expect(() => f.session.finish()).toThrow('먼저')
    const save = join(f.home, 'crawl/saves/Tester.cs')
    writeFileSync(save, new Uint8Array([4, 5, 6]))
    writeFileSync(call[2].env.HNS_DESKTOP_CHECKPOINT + '.ready', '', 'utf8')
    await vi.advanceTimersByTimeAsync(500)
    const checkpoint = unpackSave(saved.mock.calls[0][0]).files
    expect(checkpoint.find(file => file.path.endsWith('Tester.cs'))?.data).toEqual(new Uint8Array([4, 5, 6]))
    expect(new TextDecoder().decode(checkpoint.find(file => file.path.endsWith('init.txt'))?.data)).toBe('hns_floor_item_rate = 500\n')
    writeFileSync(call[2].env.HNS_DESKTOP_MANAGE, '', 'utf8')
    f.child.emit('exit', 0)
    expect((await result).manage).toBe(true)
    expect(existsSync(join(f.home, 'active.json'))).toBe(true)
    f.session.finish()
    expect(existsSync(join(f.home, 'active.json'))).toBe(false)
  })
  it('retains the final snapshot for recovery until the renderer acknowledges it, including deletions', async () => {
    const f = fixture()
    const result = f.session.play('', f.bytes, () => {})
    rmSync(join(f.home, 'crawl/saves/Tester.cs'))
    f.child.emit('exit', 1)
    expect((await result).code).toBe(1)
    const recovered = f.session.recover()!
    expect(unpackSave(recovered).files.map(file => file.path)).not.toContain('/crawl/saves/Tester.cs')
    expect(unpackSave(recovered).files.map(file => file.path)).toContain('/crawl/init.txt')
    f.session.finish()
    expect(f.session.recover()).toBeNull()
  })
})
