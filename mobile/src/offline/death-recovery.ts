import { cloudStore, type Archive } from '../cloud/store'
import { insertOfflineSave, readOfflineFiles, type SavedFile } from './save-transfer'

const SAVE = /^\/crawl\/saves\/(?:sprint\/|descent\/)?[^/]+\.cs$/
const INFO = /^(\/crawl\/saves\/(?:sprint\/|descent\/)?)(?:recovery\/)([^/]+)\.json$/

export interface DeathRecovery {
  id: string
  name: string
  when: number
  checkpoint: boolean
  available: boolean
  file: SavedFile
}

function characterFile(file: SavedFile): boolean {
  return typeof file?.path === 'string' && SAVE.test(file.path)
    && file.data instanceof Uint8Array && file.data.length >= 16
    && file.data[0] === 68 && file.data[1] === 67 && file.data[2] === 83 && file.data[3] === 83
}

// Old clients' automatic cloud archives remain useful after a death. Pick the
// latest copy of each character, with its actual save time, not archive time.
export function findDeathRecoveries(files: SavedFile[], archives: Archive[]): DeathRecovery[] {
  const live = new Set(files.map(f => f.path))
  const latest = new Map<string, DeathRecovery>()
  function add(copy: Omit<DeathRecovery, 'available'>): void {
    if (!characterFile(copy.file) || !Number.isFinite(copy.when)
      || copy.when < 0 || copy.when > Date.now() + 300_000) return
    if ((latest.get(copy.file.path)?.when ?? -1) >= copy.when) return
    latest.set(copy.file.path, { ...copy, available: !live.has(copy.file.path) })
  }
  for (const archive of archives) {
    if (!Array.isArray(archive?.snapshot?.files)) continue
    for (const file of archive.snapshot.files) {
      if (!characterFile(file)) continue
      add({ id: `archive:${archive.id}:${file.path}`, name: file.path.split('/').pop()!.slice(0, -3),
        when: file.mtimeMs, checkpoint: false, file })
    }
  }
  const byPath = new Map(files.map(f => [f.path, f]))
  for (const info of files) {
    const match = INFO.exec(info.path)
    if (!match || info.data.length > 4096) continue
    try {
      const meta: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(info.data))
      if (!meta || typeof meta !== 'object') continue
      const { name, when, checkpoint } = meta as Record<string, unknown>
      if (typeof name !== 'string' || !name || typeof when !== 'number' || checkpoint !== true) continue
      const source = byPath.get(info.path.slice(0, -5) + '.cs')
      if (!source) continue
      add({ id: `checkpoint:${source.path}`, name, when, checkpoint: true,
        file: { ...source, path: `${match[1]}${match[2]}.cs` } })
    } catch { /* A broken sidecar must not hide another character's copy. */ }
  }
  return [...latest.values()].sort((a, b) => b.when - a.when)
}

export async function readDeathRecoveries(): Promise<DeathRecovery[]> {
  const [files, archives] = await Promise.all([
    readOfflineFiles(), cloudStore.archives().catch(() => []),
  ])
  return findDeathRecoveries(files, Array.isArray(archives) ? archives : [])
}

// Called with the engine/cloud ownership lease held by cloud/runtime.ts.
export async function restoreDeathRecoveryFile(id: string): Promise<void> {
  const copy = (await readDeathRecoveries()).find(entry => entry.id === id)
  if (!copy) throw new Error('복구 사본을 찾지 못했습니다. 목록을 다시 열어 주세요.')
  if (!copy.available) throw new Error('같은 이름의 저장 게임이 이미 있습니다. 기존 진행은 덮어쓰지 않습니다.')
  await insertOfflineSave({ ...copy.file, mtimeMs: Date.now() })
}
