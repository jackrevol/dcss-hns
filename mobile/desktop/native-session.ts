import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { nativeFiles, replaceNativeFiles, atomicWrite } from '../native/storage'
import { packSave, unpackSave } from '../src/offline/save-transfer'
import { validateOfflineName } from '../src/offline/offline-state'
import type { DesktopAction, DesktopActionData } from '../src/platform/desktop-actions'

export function createNativeSession(home: string, assets: string, launch: typeof spawn = spawn) {
  const active = join(home, 'active.json'), request = join(home, 'checkpoint')
  const journal = join(home, 'menu.pzsave'), response = join(home, 'menu-response.json')
  let child: ChildProcess | undefined
  let running = false
  let menuLocal = false
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
    const owner = JSON.parse(readFileSync(active, 'utf8')) as { pid?: number; menu?: boolean }
    if (owner.pid) {
      try { process.kill(owner.pid, 0); throw new Error('기존 PC 게임이 실행 중입니다. 게임을 저장하고 종료하세요.') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    if (existsSync(journal)) return new Uint8Array(readFileSync(journal))
    return owner.menu ? null : stablePack()
  }
  function finish(): void {
    if (running) throw new Error('게임을 먼저 저장하고 종료하세요.')
    rmSync(active, { force: true })
    rmSync(journal, { force: true })
  }
  function menuStarted(): void {
    if (!running) throw new Error('Native menu is not active')
    menuLocal = true
    atomicWrite(active, JSON.stringify({ pid: child?.pid, menu: true }))
  }
  async function play(name: string, bytes: Uint8Array, onCheckpoint: (pack: Uint8Array) => void,
    onAction?: (action: DesktopAction, pack: Uint8Array) => Promise<{ data: DesktopActionData; pack: Uint8Array }>): Promise<{ pack: Uint8Array; code: number; manage: boolean; preserveLocal?: boolean }> {
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
    for (const path of [request, request + '.ready', management, response]) rmSync(path, { force: true })
    atomicWrite(active, JSON.stringify({ name }))
    running = true
    menuLocal = false
    let timer: ReturnType<typeof setInterval> | undefined, poll: ReturnType<typeof setInterval> | undefined
    let actions = Promise.resolve(), pendingAction = false, output = ''
    try {
      const executable = manifest.platform === 'linux' ? asset('DCSS HNS') : asset(manifest.binary)
      child = launch(executable, [...(name ? ['-name', name] : []), '-rc', rc, '-morgue', join(crawl, 'morgue'), '-macro', join(crawl, 'saves'),
        '-extra-opt-last', 'crawl_dir=' + crawl,
        '-extra-opt-last', 'save_dir=' + join(crawl, 'saves')], {
        cwd: asset(manifest.data), stdio: ['ignore', 'pipe', process.env.HNS_DESKTOP_UI_TEST ? 'pipe' : 'ignore'], windowsHide: false,
        env: { ...process.env, CRAWL_DIR: crawl + sep, HNS_DESKTOP_CHECKPOINT: request,
          HNS_DESKTOP_MANAGE: management, HNS_DESKTOP_RESPONSE: response },
      })
      if (process.env.HNS_DESKTOP_UI_TEST) child.stderr?.on('data', (chunk: Buffer) => {
        appendFileSync(process.env.HNS_DESKTOP_UI_TEST! + '.stderr', chunk, { encoding: 'utf8' })
      })
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        output += chunk
        if (output.length > 32 * 1024 * 1024) { output = ''; return }
        let newline: number
        while ((newline = output.indexOf('\n')) !== -1) {
          const line = output.slice(0, newline).trim(); output = output.slice(newline + 1)
          if (!line.startsWith('HNS_DESKTOP_ACTION ')) {
            if (process.env.HNS_DESKTOP_UI_TEST) appendFileSync(process.env.HNS_DESKTOP_UI_TEST + '.stderr', line + '\n', 'utf8')
            continue
          }
          if (pendingAction || !onAction) continue
          let action: DesktopAction
          try {
            action = JSON.parse(line.slice('HNS_DESKTOP_ACTION '.length))
            if (!Number.isSafeInteger(action.id) || typeof action.kind !== 'string') continue
          } catch { continue }
          if (process.env.HNS_DESKTOP_UI_TEST) appendFileSync(process.env.HNS_DESKTOP_UI_TEST + '.stderr', `Menu action: ${action.kind}\n`, 'utf8')
          pendingAction = true
          actions = actions.then(async () => {
            const result = await onAction!(action, stablePack())
            const incoming = unpackSave(result.pack).files, existing = nativeFiles(crawl)
            const changed = incoming.length !== existing.length || incoming.some(file => {
              const old = existing.find(old => old.path === file.path)
              return !old || !Buffer.from(old.data).equals(Buffer.from(file.data))
            })
            if (changed && !result.data.fatal) {
              // 열려 있는 SQLite 캐시를 보존하며 메뉴에서만 세이브를 교체합니다.
              atomicWrite(journal, result.pack)
              const wanted = new Set(incoming.map(file => file.path))
              for (const file of incoming) {
                const path = join(crawl, file.path.slice('/crawl/'.length))
                mkdirSync(resolve(path, '..'), { recursive: true })
                atomicWrite(path, file.data)
              }
              for (const file of existing) if (!wanted.has(file.path)) rmSync(join(crawl, file.path.slice('/crawl/'.length)))
              rmSync(journal, { force: true })
            }
            if (!result.data.fatal) {
              menuLocal = false
              atomicWrite(active, JSON.stringify({ name, pid: child?.pid }))
            }
            atomicWrite(response, JSON.stringify({ ...result.data, id: action.id, reload: changed || !!result.data.reload }))
          }).catch(() => {
            atomicWrite(response, JSON.stringify({ id: action.id, ok: false, fatal: true, message: 'Could not apply save changes. Restart to recover.' }))
          }).finally(() => { pendingAction = false })
        }
      })
      if (child.pid) atomicWrite(active, JSON.stringify({ name, pid: child.pid }))
      if (process.env.HNS_DESKTOP_UI_TEST) appendFileSync(process.env.HNS_DESKTOP_UI_TEST + '.stderr', `Native started: ${child.pid}\n`, 'utf8')
      const exited = new Promise<number>((resolve, reject) => {
        child!.once('error', reject)
        child!.once('exit', code => resolve(code ?? 1))
      })
      timer = setInterval(checkpoint, 60_000)
      poll = setInterval(() => {
        if (pendingAction) return
        if (!existsSync(request + '.ready')) return
        try {
          const bytes = stablePack()
          if (!existsSync(request + '.ready')) { checkpoint(); return }
          rmSync(request + '.ready', { force: true })
          onCheckpoint(bytes)
        } catch { /* 다음 폴링에서 완성된 저장을 다시 읽습니다. */ }
      }, 50)
      const code = await exited
      if (process.env.HNS_DESKTOP_UI_TEST) appendFileSync(process.env.HNS_DESKTOP_UI_TEST + '.stderr', `Native exited: ${code}\n`, 'utf8')
      await actions
      atomicWrite(active, JSON.stringify({ name, menu: menuLocal }))
      return { pack: existsSync(journal) ? new Uint8Array(readFileSync(journal)) : stablePack(),
        code, manage: existsSync(management), preserveLocal: menuLocal && !existsSync(journal) }
    } finally {
      if (timer) clearInterval(timer)
      if (poll) clearInterval(poll)
      running = false
      child = undefined
    }
  }
  return { play, recover, finish, checkpoint, menuStarted, get running() { return running } }
}
