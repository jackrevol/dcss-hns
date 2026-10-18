import { acquireOfflineOwnership, recoverOfflineOwnership } from '../cloud/ownership'
import { cloud, connectCloudAccount, disconnectCloudAccount, initializeCloud, refreshCloudAccount, restoreCloudArchive, syncIdle } from '../cloud/runtime'
import { cloudAccount, signInCloud, signUpCloud } from '../cloud/supabase-provider'
import { cloudStore } from '../cloud/store'
import { deleteGameRecord, readGameRecords, readMorgueText, sortRecords } from '../offline/game-records'
import { LOOT_FIELDS, parseLootSettings, writeLootSettings, type LootSettings } from '../offline/loot-settings'
import { morgueFileName } from '../offline/xlog'
import { buildExportPackFile, fetchEngineBuild, readOfflineFile, readOfflineFiles, sharePack, unpackSave, writeOfflineFiles } from '../offline/save-transfer'

export interface DesktopAction { id: number; kind: string; values?: Record<string, unknown> }
export type DesktopActionData = Record<string, unknown>

async function local<T>(action: () => Promise<T>): Promise<T> {
  const release = await acquireOfflineOwnership()
  try { return await action() } finally { await release() }
}
const rcText = async (): Promise<string> => new TextDecoder().decode(await readOfflineFile('/crawl/init.txt') || new Uint8Array())
const saveRc = async (text: string): Promise<void> => {
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw new Error('Options file is too large')
  await writeOfflineFiles([{ path: '/crawl/init.txt', mode: 0o100664, mtimeMs: Date.now(), data: new TextEncoder().encode(text) }])
}
const value = (action: DesktopAction, key: string): string => {
  const result = action.values?.[key]
  if (typeof result !== 'string') throw new Error('Invalid menu input')
  return result
}

// 화면은 SDL 원본 위젯이 그리며 저장과 계정 기능은 기존 구현을 공유합니다.
export async function desktopAction(action: DesktopAction): Promise<DesktopActionData> {
  const ok = (message: string, extra: DesktopActionData = {}): DesktopActionData => ({ ok: true, message, ...extra })
  switch (action.kind) {
    case 'loot-get': return local(async () => ok('', { values: parseLootSettings(await rcText()) }))
    case 'loot-save': return local(async () => {
      const settings = Object.fromEntries(LOOT_FIELDS.map(field => [field.key, action.values?.[field.key]])) as LootSettings
      await saveRc(writeLootSettings(await rcText(), settings))
      return ok('Drop settings saved. They apply when you start or resume a game.')
    })
    case 'rc-get': return local(async () => ok('', { text: await rcText() }))
    case 'rc-save': return local(async () => { await saveRc(value(action, 'text')); return ok('Options saved.') })
    case 'backup-export': return local(async () => {
      const files = await readOfflineFiles()
      if (!files.length) return ok('There are no saved files to export.')
      const saved = await sharePack(buildExportPackFile(files, await fetchEngineBuild()), () => {})
      return ok(saved ? 'Save backup exported.' : 'Export cancelled.')
    })
    case 'backup-import': return local(async () => {
      const bytes = await window.HnsDesktop!.importFile()
      if (!bytes) return ok('Import cancelled.')
      const { files } = unpackSave(bytes)
      await writeOfflineFiles(files)
      return ok(`Imported ${files.length} files.`, { reload: true })
    })
    case 'records': return local(async () => {
      const records = sortRecords(await readGameRecords(), action.values?.sort === 'score' ? 'score' : 'recent')
      return ok('', { items: records.map(record => ({ id: JSON.stringify(record),
        title: `${record.name || '?'} · ${record.char || ''} · ${record.sc || '0'} points · ${record.end || ''}` })) })
    })
    case 'record-detail': case 'record-delete': case 'record-export': return local(async () => {
      const id = value(action, 'id'), record = (await readGameRecords()).find(record => JSON.stringify(record) === id)
      if (!record) throw new Error('Record not found')
      if (action.kind === 'record-delete') { await deleteGameRecord(record); return ok('Record removed.', { reload: true }) }
      const name = morgueFileName(record.name || '', record.end || '')
      if (!name) return ok('No morgue filename is available for this record.', { title: 'Morgue', text: 'No morgue file is available.' })
      const text = await readMorgueText('/crawl/morgue/' + name)
      if (action.kind === 'record-export' && text !== null) {
        const saved = await window.HnsDesktop!.exportFile(name, new TextEncoder().encode(text))
        return ok(saved ? 'Morgue exported.' : 'Export cancelled.')
      }
      return ok('', { title: name, text: text || 'No morgue file is available for this record.' })
    })
    case 'cloud-login': case 'cloud-signup': {
      const username = value(action, 'username'), password = value(action, 'password')
      if (action.kind === 'cloud-signup') await signUpCloud(username, password)
      else await signInCloud(username, password)
      await refreshCloudAccount()
      return ok('Signed in. Link your saves to enable synchronization.')
    }
    case 'cloud-link': await connectCloudAccount(); return ok('This device is linked to your account.')
    case 'cloud-sync': await syncIdle(); return ok('Synchronization finished.')
    case 'cloud-local': await syncIdle({ choice: 'local' }); return ok('Local progress selected for conflicting files.')
    case 'cloud-remote': await syncIdle({ choice: 'remote' }); return ok('Cloud progress selected for conflicting files.', { reload: true })
    case 'cloud-logout': await disconnectCloudAccount(); return ok('Signed out. Local saves are kept.')
    case 'cloud-unlock': await recoverOfflineOwnership(); return ok('Stale lock cleared.')
    case 'cloud-restore': await restoreCloudArchive(value(action, 'id')); return ok('Recovery copy restored.', { reload: true })
    case 'cloud-export': {
      const entry = (await cloudStore.archives()).find(entry => entry.id === value(action, 'id'))
      if (!entry) throw new Error('Recovery copy not found')
      const saved = await sharePack(buildExportPackFile(entry.snapshot.files, entry.snapshot.build), () => {})
      return ok(saved ? 'Recovery copy exported.' : 'Export cancelled.')
    }
    case 'cloud-status': {
      await initializeCloud()
      const account = cloudAccount(), archives = await cloudStore.archives()
      return ok('', { account: account?.username || '', linked: !!cloud.link, phase: cloud.state.phase,
        conflicts: cloud.state.conflicts || [],
        archives: archives.map(entry => ({ id: entry.id, title: `${entry.when} · ${entry.snapshot.files.length} files` })) })
    }
    default: throw new Error('Unknown native menu action')
  }
}
