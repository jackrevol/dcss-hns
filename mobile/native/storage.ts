import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, lstatSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { decodeSnapshot, encodeSnapshot, snapshot, type Snapshot } from '../src/cloud/snapshot'
import { validateSavedFiles, type SavedFile } from '../src/offline/save-transfer'

export function atomicWrite(path: string, value: string | Uint8Array): void {
  const temporary = path + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, value, { mode: 0o600, encoding: 'utf8' })
  try { renameSync(temporary, path) } finally { rmSync(temporary, { force: true }) }
}
export function writeNativeSaveFile(path: string, file: SavedFile): void {
  atomicWrite(path, file.data)
  // 다운로드·앱 시작 때 파일을 복사해도 최근 플레이 시각으로 바뀌지 않습니다.
  const seconds = file.mtimeMs >= 0 && file.mtimeMs <= Date.now() + 5 * 60_000 ? file.mtimeMs / 1000 : 0
  utimesSync(path, seconds, seconds)
}
export function nativeFiles(root: string): SavedFile[] {
  const files: SavedFile[] = []
  const walk = (directory: string, relative: string): void => {
    if (!existsSync(directory)) return
    for (const name of readdirSync(directory).sort()) {
      const path = relative ? relative + '/' + name : name
      if (path === '.pocketzot-prewarm' || path === 'saves/db' || path === 'saves/des') continue
      const full = join(directory, name), info = lstatSync(full)
      if (info.isSymbolicLink()) throw new Error('세이브 폴더의 심볼릭 링크는 동기화하지 않습니다: ' + path)
      if (info.isDirectory()) walk(full, path)
      else if (info.isFile()) files.push({ path: '/crawl/' + path, mode: 0o100664,
        mtimeMs: info.mtimeMs, data: new Uint8Array(readFileSync(full)) })
    }
  }
  walk(root, '')
  validateSavedFiles(files)
  return files
}
export function recoverNativeDirectory(home: string): void {
  const root = join(home, 'crawl'), previous = join(home, 'crawl.previous')
  if (!existsSync(root) && existsSync(previous)) renameSync(previous, root)
  mkdirSync(root, { recursive: true, mode: 0o700 })
}
export function replaceNativeFiles(home: string, files: SavedFile[]): void {
  validateSavedFiles(files)
  const root = join(home, 'crawl'), previous = join(home, 'crawl.previous')
  const staged = join(home, 'crawl.stage-' + randomUUID())
  recoverNativeDirectory(home)
  mkdirSync(staged, { mode: 0o700 })
  try {
    for (const file of files) {
      const destination = resolve(staged, file.path.slice('/crawl/'.length))
      if (!destination.startsWith(resolve(staged) + sep)) throw new Error('잘못된 세이브 경로')
      mkdirSync(resolve(destination, '..'), { recursive: true, mode: 0o700 })
      writeNativeSaveFile(destination, file)
    }
    rmSync(previous, { recursive: true, force: true })
    renameSync(root, previous)
    try { renameSync(staged, root) }
    catch (error) { renameSync(previous, root); throw error }
    // Keep previous until the next replacement, in addition to archives.
  } finally { rmSync(staged, { recursive: true, force: true }) }
}
export function createNativeIO(home: string, build?: string) {
  const state = join(home, 'state'), archives = join(home, 'archives')
  mkdirSync(state, { recursive: true, mode: 0o700 }); mkdirSync(archives, { recursive: true, mode: 0o700 })
  recoverNativeDirectory(home)
  const keyPath = (key: string) => join(state, createHash('sha256').update(key).digest('hex') + '.pzsave')
  return {
    local: () => snapshot(nativeFiles(join(home, 'crawl')), build),
    async replace(value: Snapshot) { replaceNativeFiles(home, value.files) },
    async base(key: string) { return existsSync(keyPath(key)) ? decodeSnapshot(readFileSync(keyPath(key))) : null },
    async setBase(key: string, value: Snapshot) { atomicWrite(keyPath(key), encodeSnapshot(value)) },
    async archive(reason: string, value: Snapshot) {
      if (!value.files.length) return
      const path = join(archives, value.hash + '.pzsave')
      if (!existsSync(path)) {
        atomicWrite(path, encodeSnapshot(value))
        atomicWrite(path + '.json', JSON.stringify({ when: new Date().toISOString(), reason }))
      }
      const entries = readdirSync(archives).filter(n => n.endsWith('.pzsave'))
        .sort((a,b) => statSync(join(archives,b)).mtimeMs - statSync(join(archives,a)).mtimeMs)
      for (const stale of entries.slice(10)) {
        rmSync(join(archives,stale)); rmSync(join(archives,stale+'.json'),{force:true})
      }
    },
  }
}

export function acquireNativeLock(home: string): { child(pid: number): void; release(): void } {
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const lock = join(home, 'active.lock')
  try { mkdirSync(lock, { mode: 0o700 }) }
  catch { throw new Error('게임/동기화가 실행 중이거나 잠금 기록이 남았습니다. 모두 종료한 뒤 native unlock을 실행하세요.') }
  const write = (childPid?: number) => atomicWrite(join(lock,'owner.json'), JSON.stringify({pid:process.pid,childPid}))
  write()
  return { child: pid => write(pid), release: () => rmSync(lock, {recursive:true,force:true}) }
}
export function recoverNativeLock(home: string): void {
  const lock = join(home,'active.lock'), path = join(lock,'owner.json')
  if (!existsSync(lock)) return
  if (!existsSync(path)) throw new Error('소유자를 확인할 수 없는 잠금입니다. 다른 게임을 모두 닫은 뒤 폴더를 확인하세요: '+lock)
  const owner = JSON.parse(readFileSync(path,'utf8')) as {pid:number;childPid?:number}
  for (const pid of [owner.pid,owner.childPid]) {
    if (!pid) continue
    try { process.kill(pid,0); throw new Error('아직 게임/동기화 프로세스가 실행 중입니다: '+pid) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e }
  }
  rmSync(lock, {recursive:true,force:true})
}
