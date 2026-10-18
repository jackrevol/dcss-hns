import { acquireOfflineOwnership } from '../cloud/ownership'
import { savedCheckpoint } from '../cloud/runtime'
import { packSave, readOfflineFiles, replaceOfflineFiles, unpackSave } from '../offline/save-transfer'

export async function recoverDesktopGame(): Promise<void> {
  const desktop = window.HnsDesktop
  if (!desktop?.native) return
  const release = await acquireOfflineOwnership()
  try {
    const pack = await desktop.recover()
    if (pack) {
      await replaceOfflineFiles(unpackSave(pack).files)
      await desktop.finish()
    }
  } finally { await release() }
}

export async function playDesktopGame(name: string, onNotice: (message: string) => void): Promise<{ code: number; manage: boolean }> {
  const desktop = window.HnsDesktop!
  let writes = Promise.resolve()
  let accepting = true
  const receive = (bytes: Uint8Array): void => {
    if (!accepting) return
    writes = writes.then(async () => {
      await replaceOfflineFiles(unpackSave(bytes).files)
      // SDL 호스트가 이미 1분 단위로 저장 요청을 묶습니다.
      savedCheckpoint(0)
      onNotice('최근 체크포인트가 저장되었습니다. 클라우드 연결 시 자동 동기화합니다.')
    }).catch(error => onNotice('저장 반영 대기: ' + (error instanceof Error ? error.message : String(error))))
  }
  const detach = desktop.onCheckpoint(receive)
  try {
    const files = await readOfflineFiles()
    const result = await desktop.play(name, packSave(files, { exportedAt: new Date().toISOString() }))
    accepting = false
    await writes
    await replaceOfflineFiles(unpackSave(result.pack).files)
    // IndexedDB 반영을 확인한 후에만 네이티브 복구 표시를 해제합니다.
    await desktop.finish()
    return { code: result.code, manage: result.manage }
  } finally { detach() }
}
