import { describe, expect, it, vi } from 'vitest'
import type { CloudProvider } from './provider'
import { CloudSynchronizer } from './sync'
import { decodeSnapshot, encodeSnapshot, mergeSnapshots, snapshot, type Snapshot } from './snapshot'

const file = (name: string, text: string) => ({
  path: `/crawl/saves/${name}`, mode: 0o100664, mtimeMs: 1, data: new TextEncoder().encode(text),
})
const save = (text: string, build = 'engine-a') => snapshot([file('hero.cs', text)], build)

async function setup(local: Snapshot, remote: Snapshot, base: Snapshot | null = null) {
  let bytes = encodeSnapshot(remote)
  const provider: CloudProvider = {
    supported: () => true,
    status: async () => ({ key: 'test', label: 'test.pzsave', allowEmpty: false }),
    disconnect: vi.fn(),
    read: vi.fn(async () => bytes),
    write: vi.fn(async value => { bytes = value }),
  }
  const io = {
    local: vi.fn(async () => local), replace: vi.fn(async () => {}),
    base: vi.fn(async () => base), setBase: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
  }
  const cloud = new CloudSynchronizer(provider, io)
  await cloud.initialize()
  return { cloud, io, provider, remote: () => decodeSnapshot(bytes) }
}

describe('cloud saves', () => {
  it('uploads local progress after retaining recovery copies', async () => {
    const base = await save('before'), local = await save('after')
    const { cloud, io, provider, remote } = await setup(local, base, base)
    await cloud.sync()
    expect((await remote()).hash).toBe(local.hash)
    expect(io.replace).not.toHaveBeenCalled()
    expect(io.archive).toHaveBeenCalledTimes(2)
    expect(io.archive.mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(provider.write).mock.invocationCallOrder[0])
    expect(cloud.state.phase).toBe('ready')
  })

  it('downloads remote progress when this device stayed at the common base', async () => {
    const base = await save('before'), remote = await save('after')
    const { cloud, io, provider } = await setup(base, remote, base)
    await cloud.sync()
    expect(io.replace).toHaveBeenCalledWith(expect.objectContaining({ hash: remote.hash }))
    expect(provider.write).not.toHaveBeenCalled()
  })

  it('does not resurrect a character deleted on the other device', async () => {
    const base = await save('alive'), empty = await snapshot([], 'engine-a')
    const { cloud, io } = await setup(base, empty, base)
    await cloud.sync()
    expect(io.replace).toHaveBeenCalledWith(expect.objectContaining({ files: [] }))
  })

  it('archives both versions and requires a choice for divergent characters', async () => {
    const base = await save('before'), local = await save('left'), remote = await save('right')
    const { cloud, io, provider } = await setup(local, remote, base)
    await expect(cloud.sync()).rejects.toThrow()
    expect(cloud.state.phase).toBe('conflict')
    expect(io.archive).toHaveBeenCalledTimes(2)
    expect(provider.write).not.toHaveBeenCalled()
    expect(io.replace).not.toHaveBeenCalled()
    await cloud.sync({ choice: 'remote' })
    expect(io.replace).toHaveBeenCalledWith(expect.objectContaining({ hash: remote.hash }))
  })

  it('rejects a conflict choice after either version changes', async () => {
    const { cloud, io, provider } = await setup(await save('left'), await save('right'))
    await expect(cloud.sync()).rejects.toThrow()
    io.local.mockResolvedValue(await save('newer-left'))
    await expect(cloud.sync({ choice: 'remote' })).rejects.toThrow(/변경/)
    expect(provider.write).not.toHaveBeenCalled()
    expect(io.replace).not.toHaveBeenCalled()
    expect(cloud.state.phase).toBe('error')
  })

  it('keeps remote changes untouched while a game owns the local files', async () => {
    const base = await save('before')
    const { cloud, io, provider } = await setup(await save('left'), await save('right'), base)
    cloud.playing = true
    await cloud.sync({ pushOnly: true })
    expect(cloud.state.phase).toBe('pending')
    expect(provider.write).not.toHaveBeenCalled()
    expect(io.replace).not.toHaveBeenCalled()
  })

  it('aborts all writes when a recovery copy cannot be stored', async () => {
    const base = await save('before')
    const { cloud, io, provider } = await setup(await save('after'), base, base)
    io.archive.mockRejectedValue(new Error('quota'))
    await expect(cloud.sync()).rejects.toThrow('quota')
    expect(provider.write).not.toHaveBeenCalled()
    expect(io.replace).not.toHaveBeenCalled()
  })

  it('rejects remote file changes detected before writing', async () => {
    const base = await save('before')
    const { cloud, io, provider } = await setup(await save('after'), base, base)
    vi.mocked(provider.read).mockResolvedValueOnce(encodeSnapshot(base)).mockResolvedValue(encodeSnapshot(await save('race')))
    await expect(cloud.sync()).rejects.toThrow(/변경/)
    expect(provider.write).not.toHaveBeenCalled()
    expect(io.replace).not.toHaveBeenCalled()
  })

  it('preserves local progress when a previously populated server save disappears', async () => {
    const local = await save('progress')
    const { cloud, io, provider } = await setup(local, local, local)
    cloud.link!.allowEmpty = true // A fresh app launch restores account metadata.
    vi.mocked(provider.read).mockResolvedValue(new Uint8Array())
    await expect(cloud.sync()).rejects.toThrow(/찾지 못/)
    expect(io.replace).not.toHaveBeenCalled()
    expect(provider.write).not.toHaveBeenCalled()
  })

  it('allows repeated syncs on a new account before the first local game', async () => {
    const empty = await snapshot([], 'engine-a')
    const { cloud, io, provider } = await setup(empty, empty)
    cloud.link!.allowEmpty = true
    vi.mocked(provider.read).mockResolvedValue(new Uint8Array())
    await cloud.sync()
    io.base.mockResolvedValue(empty)
    await expect(cloud.sync()).resolves.toBeUndefined()
    expect(io.replace).not.toHaveBeenCalled()
  })

  it('blocks a different engine build even when file contents match', async () => {
    const { cloud } = await setup(await save('same'), await save('same', 'engine-b'))
    await expect(cloud.sync()).rejects.toThrow(/빌드/)
    expect(cloud.state.phase).toBe('incompatible')
  })

  it('blocks a different engine build', async () => {
    const { cloud, io, provider } = await setup(await save('left'), await save('right', 'engine-b'))
    await expect(cloud.sync()).rejects.toThrow(/빌드/)
    expect(cloud.state.phase).toBe('incompatible')
    expect(provider.write).not.toHaveBeenCalled()
    expect(io.replace).not.toHaveBeenCalled()
  })
})

describe('snapshot merge', () => {
  it('merges independent characters without splicing binary packages', async () => {
    const left = await snapshot([file('a.cs', 'a')]), right = await snapshot([file('b.cs', 'b')])
    const merged = mergeSnapshots(null, left, right)
    expect(merged.conflicts).toEqual([])
    expect(merged.files.map(f => f.path)).toEqual(['/crawl/saves/a.cs', '/crawl/saves/b.cs'])
  })

  it('merges complete append-only logfile entries and deduplicates shared additions', async () => {
    const base = await snapshot([file('logfile', 'base\n')])
    const left = await snapshot([file('logfile', 'base\nshared\nleft\n')])
    const right = await snapshot([file('logfile', 'base\nshared\nright\n')])
    const merged = mergeSnapshots(base, left, right)
    expect(merged.conflicts).toEqual([])
    expect(new TextDecoder().decode(merged.files[0].data)).toBe('base\nshared\nleft\nright\n')
  })

  it('treats deleting a character that progressed remotely as a conflict', async () => {
    const merged = mergeSnapshots(await save('base'), await snapshot([]), await save('progress'))
    expect(merged.conflicts).toEqual(['/crawl/saves/hero.cs'])
  })

  it('ignores transport timestamps when identifying game progress', async () => {
    const first = file('hero.cs', 'same')
    expect((await snapshot([first])).hash).toBe((await snapshot([{ ...first, mtimeMs: 100 }])).hash)
  })
})
