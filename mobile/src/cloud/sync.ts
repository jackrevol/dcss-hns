import type { CloudLink, CloudProvider } from './provider'
import { CloudRaceError } from './provider'
import { decodeSnapshot, digest, encodeSnapshot, mergeSnapshots, snapshot, type Snapshot } from './snapshot'

export type CloudPhase = 'off' | 'ready' | 'syncing' | 'pending' | 'conflict' | 'error' | 'incompatible'
export interface CloudState {
  phase: CloudPhase
  message: string
  label?: string
  conflicts?: string[]
  lastSync?: number
}
export interface CloudIO {
  local(): Promise<Snapshot>
  replace(value: Snapshot): Promise<void>
  base(key: string): Promise<Snapshot | null>
  setBase(key: string, value: Snapshot): Promise<void>
  archive(reason: string, value: Snapshot): Promise<void>
  compatible?(value: Snapshot): Promise<boolean>
}
export class CloudBlockedError extends Error {}
export type CloudDirection = 'upload' | 'download'

export class CloudSynchronizer {
  state: CloudState = { phase: 'off', message: '연결된 계정 없음' }
  playing = false
  link: CloudLink | null = null
  private conflict: { local: string; remote: string } | null = null
  private generation = 0
  private listeners = new Set<(state: CloudState) => void>()
  constructor(readonly provider: CloudProvider, private readonly io: CloudIO) {}

  subscribe(listener: (state: CloudState) => void): () => void {
    this.listeners.add(listener); listener(this.state)
    return () => { this.listeners.delete(listener) }
  }
  private set(phase: CloudPhase, message: string, conflicts?: string[]): void {
    this.state = { phase, message, label: this.link?.label, conflicts,
      lastSync: phase === 'ready' ? Date.now() : this.state.lastSync }
    this.listeners.forEach(fn => fn(this.state))
  }
  async initialize(): Promise<void> {
    if (!this.provider.supported()) return
    try {
      const link = await this.provider.status()
      if (this.link?.key !== link?.key) this.conflict = null
      this.link = link
      if (this.link) this.set('pending', '클라우드 동기화 대기')
      else this.set('off', '로그인 후 세이브를 연결하세요.')
    } catch (e) { this.set('error', String(e instanceof Error ? e.message : e)); throw e }
  }
  cancelSync(): void {
    this.generation++
    if (this.state.phase === 'syncing') this.set('pending', '동기화 대기 · 진행은 이 기기에 저장됩니다.')
  }
  pending(): void {
    if (this.link) this.set('pending', '저장된 진행을 클라우드에 보내는 중')
  }
  async disconnect(): Promise<void> {
    if (this.playing) throw new CloudBlockedError('게임을 저장하고 종료한 뒤 연결을 변경하세요.')
    await this.provider.disconnect(); this.link = null; this.conflict = null
    this.set('off', '연결된 계정 없음')
  }

  private async requireCompatible(local: Snapshot, remote: Snapshot): Promise<void> {
    const hasCharacter = remote.files.some(f => f.path.endsWith('.cs'))
    let message = ''
    if (hasCharacter && !local.build)
      message = '이 기기에 게임 데이터를 먼저 설치한 뒤 동기화하세요.'
    else if (hasCharacter && !remote.build)
      message = '클라우드 세이브의 엔진 빌드를 확인할 수 없습니다. 백업을 내보내 확인하세요.'
    else if (remote.files.length && remote.build && local.build && remote.build !== local.build)
      message = '클라우드의 엔진 빌드가 다릅니다. 양쪽 앱 버전을 확인하세요.'
    if (message) {
      // PC는 빌드 해시가 달라도 실제 SDL 엔진이 저장 형식을 읽을 수 있으면 허용합니다.
      if (await this.io.compatible?.(remote)) return
      this.set('incompatible', message)
      throw new CloudBlockedError(message)
    }
  }

  // 명시적인 방향 복사는 세이브 전체를 복사합니다. 자동 병합이나 충돌 선택과
  // 달리 반대쪽 파일을 섞지 않으며, 목적지의 기존 진행은 먼저 보관합니다.
  async transfer(direction: CloudDirection): Promise<void> {
    if (!this.link) throw new CloudBlockedError('Sign in before copying saves.')
    if (this.playing) throw new CloudBlockedError('Save and close the game before copying saves.')
    const link = this.link, generation = this.generation
    const check = (): void => {
      if (generation !== this.generation) throw new CloudBlockedError('Save copy cancelled. Your files are preserved.')
    }
    this.set('syncing', direction === 'upload' ? '로컬 세이브 업로드 중' : '클라우드 세이브 다운로드 중')
    try {
      const local = await this.io.local()
      check()
      const raw = await this.provider.read()
      check()
      if (direction === 'download' && !raw.length)
        throw new CloudBlockedError('There are no cloud saves to download.')
      const remote = await decodeSnapshot(raw, true)
      const source = direction === 'upload' ? local : remote
      if (!source.files.length)
        throw new CloudBlockedError(direction === 'upload' ? 'There are no local saves to upload.' : 'There are no cloud saves to download.')
      if (direction === 'download') await this.requireCompatible(local, remote)
      else if (local.files.some(f => f.path.endsWith('.cs')) && !local.build)
        throw new CloudBlockedError('The installed game version could not be read. Your saves are preserved.')
      const next = await snapshot(source.files, local.build)
      const rawHash = await digest(raw)
      await this.io.archive('복사 전 이 기기', local)
      await this.io.archive('복사 전 클라우드', remote)
      check()
      if (await digest(await this.provider.read()) !== rawHash) throw new CloudRaceError()
      check()
      if (direction === 'upload') {
        if (next.hash !== remote.hash || next.build !== remote.build) {
          await this.provider.write(encodeSnapshot(next), rawHash)
          check()
          const stored = await decodeSnapshot(await this.provider.read())
          if (stored.hash !== next.hash || stored.build !== next.build) throw new CloudRaceError()
        }
      } else if (next.hash !== local.hash) {
        await this.io.replace(next)
      }
      check()
      await this.io.setBase(link.key, next)
      link.allowEmpty = false
      this.conflict = null
      this.set('ready', direction === 'upload' ? '로컬 → 클라우드 복사 완료' : '클라우드 → 로컬 복사 완료')
    } catch (error) {
      if (this.state.phase === 'syncing') this.set('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async sync(options: { pushOnly?: boolean; choice?: 'local' | 'remote'; allowBuild?: boolean; latest?: boolean } = {}): Promise<void> {
    if (!this.link) return
    if (this.playing && !options.pushOnly) throw new CloudBlockedError('플레이 중에는 클라우드 세이브를 불러오지 않습니다.')
    const generation = this.generation
    const check = (): void => {
      if (generation !== this.generation) throw new CloudBlockedError('동기화 대기 · 진행은 이 기기에 저장됩니다.')
    }
    const previousConflict = this.conflict
    this.set('syncing', '클라우드를 확인하는 중')
    try {
      const local = await this.io.local()
      check()
      const raw = await this.provider.read()
      check()
      const base = await this.io.base(this.link.key)
      if (raw.length === 0 && base?.files.length)
        throw new CloudBlockedError('기존 클라우드 세이브를 찾지 못했습니다. 기기 세이브와 복구 사본을 유지합니다.')
      const remote = await decodeSnapshot(raw, this.link.allowEmpty || (raw.length === 0 && base?.files.length === 0))
      const rawHash = await digest(raw)
      check()

      if (options.choice && (!previousConflict || previousConflict.local !== local.hash || previousConflict.remote !== remote.hash))
        throw new CloudRaceError()

      if (!options.allowBuild) await this.requireCompatible(local, remote)
      check()
      if (local.hash === remote.hash) {
        if (raw.length) this.link.allowEmpty = false
        await this.io.setBase(this.link.key, local)
        this.conflict = null; this.set('ready', '클라우드와 같은 진행 상태'); return
      }
      if (options.pushOnly && (!base || base.hash !== remote.hash)) {
        this.set('pending', '다른 기기의 변경을 확인했습니다. 게임을 저장·종료한 뒤 동기화하세요.'); return
      }
      const merged = mergeSnapshots(base, local, remote, options.choice || (options.latest ? 'latest' : undefined))
      if (merged.conflicts.length) {
        await this.io.archive('충돌: 이 기기', local)
        await this.io.archive('충돌: 클라우드', remote)
        check()
        this.conflict = { local: local.hash, remote: remote.hash }
        this.set('conflict', '양쪽에서 진행한 데이터가 있습니다. 복구 사본을 보존했습니다.', merged.conflicts)
        throw new CloudBlockedError(this.state.message)
      }
      const next = await snapshot(merged.files, local.build)
      // A failed backup aborts all writes. Storage errors must not cost a run.
      await this.io.archive('동기화 전 이 기기', local)
      await this.io.archive('동기화 전 클라우드', remote)
      check()
      if (await digest(await this.provider.read()) !== rawHash) throw new CloudRaceError()
      check()
      if (next.hash !== remote.hash) {
        const bytes = encodeSnapshot(next)
        await this.provider.write(bytes, rawHash)
        check()
        // File providers are not cross-device compare-and-swap servers.
        // Verify the local provider result and retain history for delayed races.
        if ((await decodeSnapshot(await this.provider.read())).hash !== next.hash) throw new CloudRaceError()
      }
      check()
      if (next.hash !== local.hash) {
        if (this.playing) throw new CloudBlockedError('게임 종료 후 클라우드의 변경을 불러오세요.')
        await this.io.replace(next)
      }
      check()
      await this.io.setBase(this.link.key, next)
      this.link.allowEmpty = false
      this.conflict = null
      this.set('ready', '클라우드 동기화 완료')
    } catch (e) {
      if (this.state.phase === 'syncing')
        this.set('error', e instanceof Error ? e.message : String(e))
      throw e
    }
  }
}
