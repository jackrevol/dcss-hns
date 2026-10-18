import { recoverOfflineOwnership } from '../cloud/ownership'
import { cloud, connectCloudAccount, disconnectCloudAccount, refreshCloudAccount, restoreCloudArchive, syncIdle } from '../cloud/runtime'
import { cloudAccount, signInCloud, signUpCloud } from '../cloud/supabase-provider'
import { cloudStore } from '../cloud/store'
import { buildExportPackFile, sharePack } from '../offline/save-transfer'
import { mountCardOverlay } from './overlay'

export function openCloudSettings(onChanged: () => void): Promise<void> {
  return new Promise(resolve => {
    let busy = false
    let unsubscribe = (): void => {}
    const { body } = mountCardOverlay('클라우드 세이브', {
      card: 'settings-card', body: 'settings-body hns-cloud-settings',
    }, () => { unsubscribe(); onChanged(); resolve() }, () => busy)
    body.innerHTML = `
      <p>게임은 이 기기에 저장되어 인터넷 없이 플레이할 수 있습니다. 로그인 후 세이브를 연결하면 저장된 진행을 클라우드와 동기화합니다. 이 기기의 로그인은 로그아웃할 때까지 유지됩니다.</p>
      <p id="cloud-account"></p>
      <p id="cloud-message" role="status" aria-live="polite"></p>
      <form id="cloud-login-form">
        <label class="login-label">아이디<input name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9_]{3,32}" minlength="3" maxlength="32" placeholder="영문·숫자·밑줄 3~32자" required /></label>
        <label class="login-label">비밀번호<input name="password" type="password" autocomplete="current-password" minlength="6" required /></label>
        <div class="hns-cloud-actions">
          <button class="settings-btn" type="submit">로그인</button>
          <button class="settings-btn" type="submit" name="signup">회원가입</button>
        </div>
      </form>
      <p id="cloud-link-note" hidden>아래 버튼을 누르면 현재 기기의 세이브를 이 계정과 연결합니다. 같은 이름의 캐릭터가 양쪽에 있으면 충돌을 확인한 뒤 선택할 수 있습니다.</p>
      <div class="hns-cloud-actions">
        <button class="settings-btn" id="cloud-link" hidden>이 계정에 기기 세이브 연결</button>
        <button class="settings-btn" id="cloud-sync" hidden>지금 동기화</button>
        <button class="settings-btn" id="cloud-logout" hidden>로그아웃</button>
      </div>
      <div id="cloud-conflict" hidden>
        <p>양쪽에서 진행한 파일이 있습니다. 양쪽 복구 사본을 보존했습니다. 충돌한 파일에 사용할 진행을 선택하세요.</p>
        <ul id="cloud-conflict-files"></ul>
        <div class="hns-cloud-actions">
          <button class="settings-btn" id="cloud-use-local">충돌 파일: 이 기기 진행 사용</button>
          <button class="settings-btn" id="cloud-use-remote">충돌 파일: 클라우드 진행 사용</button>
        </div>
      </div>
      <div id="cloud-lock-recovery" hidden>
        <p>잠금 오류가 남아 있으면 다른 게임 창을 모두 저장·종료한 뒤 해제하세요. 실행 중인 다른 창이 있을 때는 해제하지 마세요.</p>
        <button class="settings-btn" id="cloud-unlock">다른 게임 창을 닫았습니다 · 잠금 해제</button>
      </div>
      <p id="cloud-error" role="alert"></p>
      <h3>이 기기의 복구 사본</h3>
      <p>최근 사본 최대 10개를 보관합니다. 복구하면 현재 기기의 세이브를 사본으로 교체하며, 교체 전 진행도 보관합니다. 내보낸 백업은 별도로 보관할 수 있습니다.</p>
      <div id="cloud-archives"></div>
    `
    const $ = <T extends HTMLElement>(selector: string): T => body.querySelector<T>(selector)!
    const error = $<HTMLElement>('#cloud-error')
    const form = $<HTMLFormElement>('#cloud-login-form')
    function render(): void {
      const account = cloudAccount()
      $<HTMLElement>('#cloud-account').textContent = account ? `계정: ${account.username}` : '로그인하지 않음'
      $<HTMLElement>('#cloud-message').textContent = cloud.state.message
      form.hidden = !!account
      $<HTMLElement>('#cloud-lock-recovery').hidden = !!navigator.locks
      $<HTMLElement>('#cloud-link').hidden = !account || !!cloud.link
      $<HTMLElement>('#cloud-link-note').hidden = !account || !!cloud.link
      $<HTMLElement>('#cloud-sync').hidden = !cloud.link
      $<HTMLElement>('#cloud-logout').hidden = !account
      $<HTMLElement>('#cloud-conflict').hidden = cloud.state.phase !== 'conflict'
      const list = $<HTMLElement>('#cloud-conflict-files')
      list.replaceChildren(...(cloud.state.conflicts ?? []).map(path => {
        const row = document.createElement('li'); row.textContent = path.replace('/crawl/', ''); return row
      }))
      for (const input of body.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button'))
        input.disabled = busy || cloud.state.phase === 'syncing'
    }
    async function archives(): Promise<void> {
      const list = await cloudStore.archives()
      if (!body.isConnected) return
      const host = $<HTMLElement>('#cloud-archives')
      host.replaceChildren()
      if (!list.length) { host.textContent = '아직 복구 사본이 없습니다.'; return }
      for (const entry of list) {
        const row = document.createElement('div'); row.className = 'hns-cloud-archive'
        const label = document.createElement('p')
        label.textContent = `${new Date(entry.when).toLocaleString()} · ${entry.reason} · ${entry.snapshot.files.length}개 파일`
        const actions = document.createElement('div'); actions.className = 'hns-cloud-actions'
        const restore = document.createElement('button'); restore.className = 'settings-btn'; restore.textContent = '기기에 복구'
        restore.addEventListener('click', () => run(() => restoreCloudArchive(entry.id)))
        const exp = document.createElement('button'); exp.className = 'settings-btn'; exp.textContent = '백업 내보내기'
        exp.addEventListener('click', () => run(async () => {
          await sharePack(buildExportPackFile(entry.snapshot.files, entry.snapshot.build), text => { error.textContent = text })
        }))
        actions.append(restore, exp); row.append(label, actions); host.append(row)
      }
      render()
    }
    function run(action: () => Promise<void>): void {
      if (busy || cloud.playing || cloud.state.phase === 'syncing') return
      busy = true; error.textContent = ''; render()
      void action().then(onChanged).catch((e: unknown) => {
        error.textContent = e instanceof Error ? e.message : String(e)
      }).finally(() => { busy = false; render(); void archives().catch(() => {}) })
    }
    form.addEventListener('submit', event => {
      event.preventDefault()
      const signup = (event as SubmitEvent).submitter?.getAttribute('name') === 'signup'
      const username = $<HTMLInputElement>('[name="username"]').value
      const password = $<HTMLInputElement>('[name="password"]').value
      run(async () => {
        if (signup) {
          const loggedIn = await signUpCloud(username, password)
          if (!loggedIn) throw new Error('계정을 활성화하지 못했습니다. 관리자에게 문의하세요.')
        } else await signInCloud(username, password)
        $<HTMLInputElement>('[name="password"]').value = ''
        await refreshCloudAccount()
      })
    })
    $<HTMLElement>('#cloud-unlock').addEventListener('click', () => run(recoverOfflineOwnership))
    $<HTMLElement>('#cloud-link').addEventListener('click', () => run(connectCloudAccount))
    $<HTMLElement>('#cloud-sync').addEventListener('click', () => run(() => syncIdle()))
    $<HTMLElement>('#cloud-logout').addEventListener('click', () => run(disconnectCloudAccount))
    $<HTMLElement>('#cloud-use-local').addEventListener('click', () => run(() => syncIdle({ choice: 'local' })))
    $<HTMLElement>('#cloud-use-remote').addEventListener('click', () => run(() => syncIdle({ choice: 'remote' })))
    unsubscribe = cloud.subscribe(render)
    void archives().catch((e: unknown) => { error.textContent = `복구 사본 확인 실패: ${e instanceof Error ? e.message : String(e)}` })
  })
}
