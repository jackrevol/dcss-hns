import './desktop.css'
import { cloud, initializeCloud, syncIdle } from '../cloud/runtime'
import { acquireOfflineOwnership } from '../cloud/ownership'
import { cloudAccount } from '../cloud/supabase-provider'
import { loadOfflineSlots } from '../offline/offline-state'
import { buildExportPackFile, fetchEngineBuild, readOfflineFiles, sharePack, unpackSave, writeOfflineFiles } from '../offline/save-transfer'
import { readGameRecords } from '../offline/game-records'
import { openLootSettings } from './loot-settings-view'
import { openCloudSettings } from './cloud-view'
import { openRcEditor } from './rc-editor'
import { openGameRecords } from './records-view'
import { registerViewDispose } from './view-dispose'

// 시작 메뉴와 캐릭터 선택은 SDL 원본을 사용합니다. 이 창은 HNS 관리 기능만 제공합니다.
export function buildDesktopManager(onReturn: () => void, notice?: string): HTMLElement {
  const view = document.createElement('main')
  view.id = 'desktop-manager'
  view.innerHTML = `
    <header class="pc-title"><img src="/desktop-assets/logo.png" alt="Dungeon Crawl Stone Soup" />
      <p>HNS SETTINGS / SAVE MANAGEMENT</p></header>
    <h1>HNS 설정 및 세이브 관리</h1>
    <div class="pc-layout">
      <nav class="pc-menu" aria-label="HNS 관리 메뉴">
        <button id="desktop-return"><kbd>Esc</kbd>던전으로 돌아가기</button>
        <hr />
        <button id="desktop-loot"><kbd>d</kbd>아이템 드랍 설정</button>
        <button id="desktop-options"><kbd>o</kbd>옵션 파일</button>
        <button id="desktop-records"><kbd>r</kbd>기록과 영안실</button>
        <hr />
        <button id="desktop-export"><kbd>b</kbd>세이브 백업</button>
        <button id="desktop-import"><kbd>i</kbd>백업 불러오기</button>
        <button id="desktop-cloud"><kbd>c</kbd>클라우드 세이브</button>
      </nav>
      <section class="pc-details" aria-label="저장 및 설정 안내">
        <h2>이 기기의 모험</h2><p id="desktop-save-summary">저장된 모험을 읽는 중…</p>
        <h2>아이템 드랍</h2><p>생성량·품질·아티팩트 확률·골드·소모품 수량을 설정합니다.<br />설정은 모든 캐릭터가 공유하며 다음 시작·재개부터 적용됩니다.</p>
        <h2>세이브와 백업</h2><p>캐릭터별 저장과 이어하기는 원본 시작 메뉴에서 사용합니다.<br />백업 파일과 클라우드 계정은 모바일과 동일하게 사용할 수 있습니다.</p>
        <p class="pc-subtitle">새 게임·종족·직업 선택, 타일 화면과 키보드·마우스 조작은 원본 DCSS를 따릅니다.</p>
      </section>
    </div>
    <footer class="pc-footer"><p id="desktop-notice" role="status" aria-live="polite"></p>
      <div><span id="desktop-cloud-status">이 기기에 저장 · 오프라인 플레이 가능</span><span id="desktop-version"></span></div></footer>
    <input id="desktop-pack-file" type="file" accept=".pzsave,application/octet-stream" hidden />
  `
  const $ = <T extends HTMLElement>(id: string): T => view.querySelector<T>('#' + id)!
  let disposed = false, busy = false
  const setNotice = (message: string): void => { $('desktop-notice').textContent = message }
  $('desktop-version').textContent = window.HnsDesktop?.version || 'DCSS HNS'
  setNotice(notice || '설정과 저장 데이터를 관리한 뒤 원본 시작 메뉴로 돌아가세요.')
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy || disposed) return
    busy = true
    for (const button of view.querySelectorAll<HTMLButtonElement>('button')) button.disabled = true
    try { await action() }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally {
      busy = false
      for (const button of view.querySelectorAll<HTMLButtonElement>('button')) button.disabled = false
    }
  }
  async function refresh(): Promise<void> {
    const { stems, chars } = await loadOfflineSlots()
    if (disposed) return
    $('desktop-save-summary').textContent = stems.length ? `${stems.length}개의 저장된 모험 · ` + stems.map(stem => chars[stem]?.name || stem).join(', ') : '저장된 모험이 없습니다. 원본 시작 메뉴에서 새 게임을 시작하세요.'
  }
  $('desktop-return').addEventListener('click', () => { if (!busy && !disposed) onReturn() })
  $('desktop-loot').addEventListener('click', () => { void openLootSettings(setNotice, () => !disposed && !busy) })
  $('desktop-options').addEventListener('click', () => { void openRcEditor(setNotice) })
  $('desktop-cloud').addEventListener('click', () => { void openCloudSettings(() => { void refresh() }) })
  $('desktop-records').addEventListener('click', () => { void run(async () => openGameRecords(await readGameRecords(), () => { void refresh() })) })
  $('desktop-export').addEventListener('click', () => { void run(async () => {
    const release = await acquireOfflineOwnership()
    try {
      const files = await readOfflineFiles()
      if (!files.length) { setNotice('백업할 저장 데이터가 없습니다.'); return }
      if (await sharePack(buildExportPackFile(files, await fetchEngineBuild()), setNotice)) setNotice('세이브 백업을 내보냈습니다.')
    } finally { await release() }
  }) })
  const picker = $<HTMLInputElement>('desktop-pack-file')
  $('desktop-import').addEventListener('click', () => picker.click())
  picker.addEventListener('change', () => { void run(async () => {
    const file = picker.files?.[0]
    if (!file) return
    const { files } = unpackSave(await file.arrayBuffer())
    const release = await acquireOfflineOwnership()
    try { await writeOfflineFiles(files) } finally { await release() }
    picker.value = ''; await refresh(); setNotice(`백업에서 ${files.length}개 파일을 불러왔습니다.`)
    void syncIdle({ pushOnly: true }).catch(() => {})
  }) })
  const cloudStatus = (): void => {
    const account = cloudAccount()
    $('desktop-cloud-status').textContent = account ? `${account.username} · ${cloud.state.message}` : '이 기기에 저장 · 오프라인 플레이 가능'
  }
  const unsubscribe = cloud.subscribe(cloudStatus)
  const keys: Record<string, string> = { d: 'loot', r: 'records', b: 'export', i: 'import', c: 'cloud', o: 'options', Escape: 'return' }
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || busy || disposed) return
    if (document.querySelector('[role="dialog"], .records-view')) return
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    if (keys[event.key]) { event.preventDefault(); $('desktop-' + keys[event.key]).click() }
  }
  document.addEventListener('keydown', onKey)
  const restored = (): void => { void refresh().catch(error => setNotice(String(error))) }
  window.addEventListener('hns-cloud-restored', restored)
  registerViewDispose(view, () => { disposed = true; unsubscribe(); document.removeEventListener('keydown', onKey); window.removeEventListener('hns-cloud-restored', restored) })
  void refresh().catch(error => setNotice(String(error)))
  void initializeCloud().then(cloudStatus).catch(() => {})
  return view
}

export function buildDesktopPlaying(): { view: HTMLElement; notice: (message: string) => void } {
  const view = document.createElement('main')
  view.id = 'desktop-playing'
  view.innerHTML = '<img src="/desktop-assets/logo.png" alt="Dungeon Crawl Stone Soup" /><h1>Dungeon Crawl Stone Soup</h1><p>원본 PC 게임 창에서 모험을 진행하세요.</p><p>시작 메뉴의 F2: HNS 설정 및 세이브 관리</p><p id="native-save-status" role="status" aria-live="polite">게임을 시작하는 중…</p>'
  return { view, notice: message => { view.querySelector('#native-save-status')!.textContent = message } }
}
