import type { Snapshot } from './snapshot'

export interface Archive { id: string; when: number; reason: string; snapshot: Snapshot }

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}
function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = t.onabort = () => reject(t.error ?? new Error('클라우드 복구 기록을 저장하지 못했습니다.'))
  })
}
async function open(): Promise<IDBDatabase> {
  const r = indexedDB.open('hns-cloud-saves', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('state')
  return request(r)
}
export async function getCloudValue<T>(key: string): Promise<T | undefined> {
  const db = await open()
  try { return await request(db.transaction('state').objectStore('state').get(key)) as T | undefined }
  finally { db.close() }
}
export async function putCloudValue(key: string, value: unknown): Promise<void> {
  const db = await open()
  try {
    const tx = db.transaction('state', 'readwrite'); const completion = done(tx)
    if (value === undefined) tx.objectStore('state').delete(key)
    else tx.objectStore('state').put(value, key)
    await completion
  } finally { db.close() }
}

export const cloudStore = {
  base: (key: string) => getCloudValue<Snapshot>('base:' + key).then(v => v ?? null),
  setBase: (key: string, value: Snapshot) => putCloudValue('base:' + key, value),
  async archives(): Promise<Archive[]> { return await getCloudValue<Archive[]>('archives') ?? [] },
  async archive(reason: string, value: Snapshot): Promise<void> {
    if (!value.files.length) return
    const db = await open()
    try {
      const tx = db.transaction('state', 'readwrite'); const completion = done(tx)
      const store = tx.objectStore('state')
      const list = await request(store.get('archives')) as Archive[] | undefined ?? []
      if (!list.some(a => a.snapshot.hash === value.hash)) {
        list.unshift({ id: crypto.randomUUID(), when: Date.now(), reason, snapshot: value })
        store.put(list.slice(0, 10), 'archives')
      }
      await completion
    } finally { db.close() }
  },
}
