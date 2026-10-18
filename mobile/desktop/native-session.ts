import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { nativeFiles, replaceNativeFiles, atomicWrite } from '../native/storage'
import { packSave, unpackSave } from '../src/offline/save-transfer'
import { validateOfflineName } from '../src/offline/offline-state'

export function createNativeSession(home: string, assets: string, launch: typeof spawn = spawn) {
  const active = join(home, 'active.json'), request = join(home, 'checkpoint')
  let child: ChildProcess | undefined
  let running = false
  const manifest = JSON.parse(readFileSync(join(assets, 'desktop.json'), 'utf8')) as { binary: string; data: string; platform: string }
  function asset(path: string): string {
    const value = resolve(assets, path)
    if (value !== resolve(assets) && !value.startsWith(resolve(assets) + sep)) throw new Error('잘못된 엔진 경로입니다.')
    return value
  }
  const pack = (files = nativeFiles(join(home, 'crawl'))): Uint8Array => packSave(files, { exportedAt: new Date().toISOString() })
  function stablePack(): Uint8Array {
    // 저장 중인 파일이 바뀌면 읽기를 다시 시도하여 완성된 체크포인트만 전달합니다.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = nativeFiles(join(home, 'crawl')), after = nativeFiles(join(home, 'crawl'))
      if (before.length === after.length && before.every((f, i) => f.path === after[i].path
          && f.mtimeMs === after[i].mtimeMs && Buffer.from(f.data).equals(Buffer.from(after[i].data)))) return pack(after)
    }
    throw new Error('저장이 진행 중입니다. 잠시 뒤 다시 시도합니다.')
  }
  const checkpoint = (): void => { if (running) writeFileSync(request, '', 'utf8') }
  function recover(): Uint8Array | null {
    if (!existsSync(active)) return null
    const owner = JSON.parse(readFileSync(active, 'utf8')) as { pid?: number }
    if (owner.pid) {
      try { process.kill(owner.pid, 0); throw new Error('기존 PC 게임이 실행 중입니다. 게임을 저장하고 종료하세요.') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    return stablePack()
  }
  function finish(): void {
    if (running) throw new Error('게임을 먼저 저장하고 종료하세요.')
    rmSync(active, { force: true })
  }
  async function play(name: string, bytes: Uint8Array, onCheckpoint: (pack: Uint8Array) => void): Promise<{ pack: Uint8Array; code: number; manage: boolean }> {
    if (running || existsSync(active)) throw new Error('이전 게임의 저장을 먼저 복구하세요.')
    const invalid = name ? validateOfflineName(name) : null
    if (invalid) throw new Error(invalid)
    const { files } = unpackSave(bytes)
    mkdirSync(home, { recursive: true })
    replaceNativeFiles(home, files)
    const crawl = join(home, 'crawl'), rc = join(crawl, 'init.txt')
    mkdirSync(join(crawl, 'saves'), { recursive: true }); mkdirSync(join(crawl, 'morgue'), { recursive: true })
    if (!existsSync(rc)) writeFileSync(rc, '', 'utf8')
    const management = join(home, 'manage')
    for (const path of [request, request + '.ready', management]) rmSync(path, { force: true })
    atomicWrite(active, JSON.stringify({ name }))
    running = true
    let timer: ReturnType<typeof setInterval> | undefined, poll: ReturnType<typeof setInterval> | undefined
    try {
      const executable = manifest.platform === 'linux' ? asset('DCSS HNS') : asset(manifest.binary)
      child = launch(executable, [...(name ? ['-name', name] : []), '-rc', rc, '-morgue', join(crawl, 'morgue'), '-macro', join(crawl, 'saves'),
        '-extra-opt-last', 'crawl_dir=' + crawl,
        '-extra-opt-last', 'save_dir=' + join(crawl, 'saves')], {
        cwd: asset(manifest.data), stdio: 'ignore', windowsHide: false,
        env: { ...process.env, CRAWL_DIR: crawl + sep, HNS_DESKTOP_CHECKPOINT: request, HNS_DESKTOP_MANAGE: management },
      })
      if (child.pid) atomicWrite(active, JSON.stringify({ name, pid: child.pid }))
      const exited = new Promise<number>((resolve, reject) => {
        child!.once('error', reject)
        child!.once('exit', code => resolve(code ?? 1))
      })
      timer = setInterval(checkpoint, 60_000)
      poll = setInterval(() => {
        if (!existsSync(request + '.ready')) return
        try {
          const bytes = stablePack()
          if (!existsSync(request + '.ready')) { checkpoint(); return }
          rmSync(request + '.ready', { force: true })
          onCheckpoint(bytes)
        } catch { /* 다음 폴링에서 완성된 저장을 다시 읽습니다. */ }
      }, 50)
      const code = await exited
      atomicWrite(active, JSON.stringify({ name }))
      return { pack: stablePack(), code, manage: existsSync(management) }
    } finally {
      if (timer) clearInterval(timer)
      if (poll) clearInterval(poll)
      running = false
      child = undefined
    }
  }
  return { play, recover, finish, checkpoint, get running() { return running } }
}
