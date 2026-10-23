import { bundledGameVersion } from '../offline/bundled-game'
import { acquireOfflineOwnership } from './ownership'
import { ARTIFACT_CACHE, cachedEngineBuild } from '../offline/artifact-store'
import { packSave, readOfflineFiles, replaceOfflineFiles } from '../offline/save-transfer'
import { cloudAccount, createSupabaseProvider, linkCloudAccount } from './supabase-provider'
import { snapshot } from './snapshot'
import { cloudStore } from './store'
import { CloudBlockedError, CloudSynchronizer, type CloudDirection } from './sync'

async function installedBuild(): Promise<string | undefined> {
  try {
    const included = await bundledGameVersion()
    if (included) return included.build
    return typeof caches === 'undefined' ? undefined : await cachedEngineBuild(await caches.open(ARTIFACT_CACHE))
  } catch { return undefined }
}

const provider = createSupabaseProvider()
export const cloud = new CloudSynchronizer(provider, {
  async local() {
    const [files, build] = await Promise.all([readOfflineFiles(), installedBuild()])
    return snapshot(files, build)
  },
  replace: value => replaceOfflineFiles(value.files),
  async compatible(value) {
    const desktop = window.HnsDesktop
    if (!desktop?.native || !desktop.checkSaveCompatibility) return false
    return desktop.checkSaveCompatibility(packSave(value.files, { exportedAt: '', build: value.build }))
  },
  ...cloudStore,
})

let queue: Promise<unknown> = Promise.resolve()
let releaseGame: (() => Promise<void>) | null = null
let initialized: Promise<void> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let starting = false
let watching = false

function serial<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action)
  queue = result.catch(() => {})
  return result
}
const lease = acquireOfflineOwnership
function linkDesktopAccount(): void {
  if (window.HnsDesktop?.native && cloudAccount()) linkCloudAccount()
}
function init(): Promise<void> {
  if (!initialized) initialized = Promise.resolve().then(async () => {
    linkDesktopAccount()
    await cloud.initialize()
  }).catch(e => { initialized = undefined; throw e })
  if (!watching) {
    watching = true
    const retry = (): void => {
      if (cloud.playing) savedCheckpoint()
      // Upload only: foregrounding must not replace files under an open RC
      // editor. Downloads happen explicitly in the lobby or after game exit.
      else if (!starting) void syncIdle({ pushOnly: true }).catch(() => {})
    }
    window.addEventListener('online', retry)
    window.addEventListener('hns-foreground', retry)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) retry() })
  }
  return initialized
}
export function initializeCloud(): Promise<void> { return init() }

export function syncIdle(options: Parameters<CloudSynchronizer['sync']>[0] = {}): Promise<void> {
  if (starting) return Promise.reject(new CloudBlockedError('게임 시작 후 저장된 진행을 동기화합니다.'))
  return serial(async () => {
    await init()
    if (!cloud.link) return
    if (starting || cloud.playing) throw new CloudBlockedError('게임을 저장하고 종료한 뒤 동기화하세요.')
    const release = await lease()
    try {
      if (starting) return
      await cloud.sync({ latest: !!window.HnsDesktop?.native, ...options })
    } finally { await release() }
  })
}
// 시작 시 네트워크 대기에 상한을 두어 오프라인에서도 로컬로 플레이합니다.
export async function prepareDesktopCloud(): Promise<void> {
  const timeout = setTimeout(() => { cloud.cancelSync(); provider.cancel() }, 4000)
  try { await syncIdle() }
  catch { /* 동기화 상태는 클라우드 메뉴에 표시하고 로컬 게임은 시작합니다. */ }
  finally { clearTimeout(timeout) }
}
export function refreshCloudAccount(): Promise<void> {
  return serial(async () => {
    if (cloud.playing || starting) throw new CloudBlockedError('게임을 먼저 종료하세요.')
    linkDesktopAccount()
    const current = await provider.status()
    if (current?.key !== cloud.link?.key) await cloud.initialize()
    initialized = Promise.resolve()
  })
}
export async function connectCloudAccount(): Promise<void> {
  await serial(async () => {
    if (cloud.playing || starting) throw new CloudBlockedError('게임을 먼저 종료하세요.')
    linkCloudAccount()
    await cloud.initialize()
    initialized = Promise.resolve()
  })
  await syncIdle()
}
export function transferCloudSaves(direction: CloudDirection): Promise<void> {
  if (starting) return Promise.reject(new CloudBlockedError('게임을 먼저 종료하세요.'))
  return serial(async () => {
    if (starting || cloud.playing) throw new CloudBlockedError('게임을 먼저 종료하세요.')
    const release = await lease()
    try {
      // 방향 선택 자체가 계정 연결 의사입니다. 연결 중에는 병합을 실행하지 않습니다.
      linkCloudAccount()
      await cloud.initialize()
      initialized = Promise.resolve()
      await cloud.transfer(direction)
    } finally { await release() }
  })
}
export function disconnectCloudAccount(): Promise<void> {
  return serial(async () => {
    if (starting) throw new CloudBlockedError('게임을 먼저 종료하세요.')
    await init(); await cloud.disconnect()
  })
}

// No auth, server read, or download on the play path. Cancel any in-flight
// sync first; serial ordering lets an already-started local IDB transaction
// finish before the engine loads it. A failed network cannot block play.
export function beginCloudGame(): Promise<void> {
  if (starting || releaseGame) return Promise.reject(new CloudBlockedError('이미 게임이 실행 중입니다.'))
  starting = true
  cloud.cancelSync()
  provider.cancel()
  return serial(async () => {
    try {
      await init().catch(() => {})
      releaseGame = await lease()
      cloud.playing = true
    } finally { starting = false }
  })
}
export function savedCheckpoint(delayMs = 60_000): void {
  if (!cloud.link || timer) return
  // Coalesce frequent checkpoints to limit full-pack bandwidth consumption.
  // This never delays the engine's local checkpoint.
  timer = setTimeout(() => {
    timer = undefined
    void serial(async () => {
      if (cloud.playing && cloud.link && !starting) {
        cloud.pending()
        await cloud.sync({ pushOnly: true, latest: !!window.HnsDesktop?.native })
      }
    }).catch(() => {})
  }, delayMs)
}
export function endCloudGame(sync = true): Promise<void> {
  if (timer) { clearTimeout(timer); timer = undefined }
  cloud.cancelSync()
  provider.cancel()
  return serial(async () => {
    cloud.playing = false
    await releaseGame?.(); releaseGame = null
  }).then(() => { if (sync) return syncIdle() }).catch(() => {})
}
export function restoreCloudArchive(id: string): Promise<void> {
  return serial(async () => {
    if (starting || cloud.playing) throw new CloudBlockedError('게임을 먼저 종료하세요.')
    const release = await lease()
    try {
      const entry = (await cloudStore.archives()).find(a => a.id === id)
      if (!entry) throw new Error('복구 사본을 찾지 못했습니다.')
      const files = await readOfflineFiles()
      await cloudStore.archive('복구 전 이 기기', await snapshot(files, await installedBuild()))
      await replaceOfflineFiles(entry.snapshot.files)
      cloud.pending()
      window.dispatchEvent(new Event('hns-cloud-restored'))
    } finally { await release() }
  })
}

export function restoreDeathRecovery(id: string): Promise<void> {
  return serial(async () => {
    if (starting || cloud.playing) throw new CloudBlockedError('게임을 먼저 종료하세요.')
    const release = await lease()
    try {
      if (starting || cloud.playing) throw new CloudBlockedError('게임을 먼저 종료하세요.')
      const { restoreDeathRecoveryFile } = await import('../offline/death-recovery')
      await restoreDeathRecoveryFile(id)
      cloud.pending()
      window.dispatchEvent(new Event('hns-cloud-restored'))
    } finally { await release() }
  })
}
