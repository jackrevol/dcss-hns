import { CloudBlockedError } from './sync'

type Release = () => Promise<void>
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('hns-offline-ownership', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('owner')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
async function change(action: (store: IDBObjectStore, value: string | undefined) => void): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('owner', 'readwrite'), store = tx.objectStore('owner')
      const r = store.get('active')
      let failure: unknown
      r.onsuccess = () => {
        try { action(store, r.result as string | undefined) }
        catch (e) { failure = e; tx.abort() }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error)
    })
  } finally { db.close() }
}

export async function acquireOfflineOwnership(): Promise<Release> {
  if (navigator.locks) {
    let release!: () => void
    let acquired!: () => void
    const ready = new Promise<void>(resolve => { acquired = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const complete = navigator.locks.request('hns-offline-owner', { ifAvailable: true }, async lock => {
      if (!lock) throw new CloudBlockedError('다른 창에서 게임이나 동기화가 실행 중입니다.')
      acquired()
      await held
    })
    await Promise.race([ready, complete])
    return async () => { release(); await complete }
  }
  // No expiring lease: a suspended game must not lose ownership and later
  // overwrite another tab. Crash leftovers require an explicit recovery tap.
  const token = crypto.randomUUID()
  await change((store, current) => {
    if (current) throw new CloudBlockedError('다른 창이 사용 중이거나 잠금 기록이 남았습니다. 다른 창을 닫은 뒤 클라우드 설정에서 잠금을 해제하세요.')
    store.put(token, 'active')
  })
  return async () => { await change((store, current) => { if (current === token) store.delete('active') }) }
}
export async function recoverOfflineOwnership(): Promise<void> {
  if (navigator.locks) throw new CloudBlockedError('다른 게임 창을 저장·종료한 뒤 다시 시도하세요.')
  await change(store => { store.delete('active') })
}
