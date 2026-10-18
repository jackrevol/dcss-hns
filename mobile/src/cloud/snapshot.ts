import { packSave, unpackSave, type SavedFile } from '../offline/save-transfer'

export const MAX_CLOUD_BYTES = 32 * 1024 * 1024
export interface Snapshot {
  files: SavedFile[]
  hashes: Record<string, string>
  hash: string
  build?: string
}

export async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('')
}

export async function snapshot(files: SavedFile[], build?: string): Promise<Snapshot> {
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const entries = await Promise.all(sorted.map(async f => [f.path, await digest(f.data)] as const))
  // mtimes and exportedAt are transport metadata, not game progress.
  return { files: sorted, hashes: Object.fromEntries(entries),
    hash: await digest(new TextEncoder().encode(JSON.stringify(entries))), build }
}

export async function decodeSnapshot(bytes: Uint8Array, allowEmpty = false): Promise<Snapshot> {
  if (bytes.byteLength > MAX_CLOUD_BYTES) throw new Error('연결 파일이 32 MB를 넘습니다.')
  if (bytes.length === 0 && allowEmpty) return snapshot([])
  const { files, meta } = unpackSave(bytes)
  if (files.some(f => /^\/crawl\/saves\/(db|des)(\/|$)/.test(f.path) || f.path === '/crawl/.pocketzot-prewarm'))
    throw new Error('클라우드 세이브에 재생성 캐시가 포함되어 있습니다.')
  return snapshot(files, meta.build)
}

export function encodeSnapshot(value: Snapshot): Uint8Array {
  const bytes = packSave(value.files, { exportedAt: new Date().toISOString(), build: value.build })
  if (bytes.byteLength > MAX_CLOUD_BYTES) throw new Error('저장 데이터가 32 MB를 넘습니다. 기존 세이브는 이 기기에 유지됩니다.')
  return bytes
}

export interface Merge {
  files: SavedFile[]
  conflicts: string[]
}

function appendLog(base: SavedFile | undefined, local: SavedFile, remote: SavedFile): SavedFile | null {
  if (local.path !== '/crawl/saves/logfile') return null
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    const before = base ? decoder.decode(base.data) : ''
    const left = decoder.decode(local.data)
    const right = decoder.decode(remote.data)
    if (!left.startsWith(before) || !right.startsWith(before)
      || [before, left, right].some(s => s && !s.endsWith('\n'))) return null
    const added = [...new Set((left.slice(before.length) + right.slice(before.length)).split('\n').filter(Boolean))]
    return { ...local, data: new TextEncoder().encode(before + added.map(s => s + '\n').join('')) }
  } catch { return null }
}

// Three-way merge. Deletions are meaningful only relative to an observed base.
// Binary character packages are never spliced or chosen by timestamp/turn count.
export function mergeSnapshots(base: Snapshot | null, local: Snapshot, remote: Snapshot,
  choice?: 'local' | 'remote'): Merge {
  const left = new Map(local.files.map(f => [f.path, f]))
  const right = new Map(remote.files.map(f => [f.path, f]))
  const before = new Map(base?.files.map(f => [f.path, f]) ?? [])
  const paths = new Set([...before.keys(), ...left.keys(), ...right.keys()])
  const files: SavedFile[] = []
  const conflicts: string[] = []
  for (const path of [...paths].sort()) {
    const b = base?.hashes[path], l = local.hashes[path], r = remote.hashes[path]
    let file: SavedFile | undefined
    if (l === r || r === b) file = left.get(path)
    else if (l === b) file = right.get(path)
    else {
      const log = left.has(path) && right.has(path) ? appendLog(before.get(path), left.get(path)!, right.get(path)!) : null
      if (log) file = log
      else if (choice) file = (choice === 'local' ? left : right).get(path)
      else { conflicts.push(path); continue }
    }
    if (file) files.push(file)
  }
  return { files, conflicts }
}
