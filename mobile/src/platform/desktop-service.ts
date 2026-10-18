import { beginCloudGame, endCloudGame } from '../cloud/runtime'
import { playDesktopGame, recoverDesktopGame } from './native-game'

// 이 문서는 화면을 그리지 않습니다. PC의 모든 UI는 원본 SDL 창에서 제공합니다.
void (async () => {
  const desktop = window.HnsDesktop!
  try {
    await recoverDesktopGame()
    await beginCloudGame()
    const result = await playDesktopGame('', () => {})
    await endCloudGame()
    if (result.code) await desktop.reportError('게임 창이 종료되었습니다. 저장된 진행은 보존했습니다. 앱을 다시 실행해 주세요.')
  } catch (error) {
    await endCloudGame(false)
    try { await recoverDesktopGame() } catch { /* 복구 표시는 다음 실행까지 보존합니다. */ }
    await desktop.reportError('PC 저장 서비스 오류. 저장 파일은 보존되어 있습니다.\n' + String(error))
  } finally { await desktop.close() }
})()
