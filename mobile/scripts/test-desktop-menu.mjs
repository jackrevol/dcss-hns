import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const profile = mkdtempSync(resolve(tmpdir(), 'hns-native-menu-'))
const output = resolve(root, 'test-results/native-menu'); mkdirSync(output, { recursive: true })
const fixture = process.env.HNS_DESKTOP_PACK || resolve(root, 'test-results/offline-backup.pzsave')
const report = resolve(profile, 'report.json'), exported = resolve(profile, 'export.pzsave'), downloaded = resolve(profile, 'downloaded.pzsave')
const steps = []
const step = (kind, value, index) => steps.push({ kind, value, index })
step('expect', 'Loading complete, press any key to start.')
step('enter')
for (const label of ['[F2] Item drops', '[F3] Options file', '[F4] Past games / morgues', '[F5] Export save backup', '[F6] Import save backup', '[F7] Cloud saves']) step('expect', label)
step('snapshot', resolve(output, 'main.png'))
if (existsSync(fixture)) {
  step('activate', '[F6] Import save backup'); step('escape'); step('expect', 'HnsSmoke')
}
step('activate', '[F2] Item drops'); step('activate', 'Edit drop settings')
step('fill', '4.5', 0); step('snapshot', resolve(output, 'drops.png'))
step('activate', '[Enter] Save / continue'); step('escape')
step('expect', '[F3] Options file'); step('activate', '[F3] Options file')
step('expect', 'hns_floor_item_rate = 450'); step('snapshot', resolve(output, 'options.png'))
step('activate', 'Discard changes')
step('activate', '[F5] Export save backup'); step('escape')
step('activate', '[F4] Past games / morgues'); step('snapshot', resolve(output, 'records.png'))
step('activate', 'Back to main menu')
step('activate', '[F7] Cloud saves'); step('expect', 'Sign in'); step('snapshot', resolve(output, 'cloud-signed-out.png'))
step('activate', 'Sign in'); step('fill', 'Tester', 0); step('fill', 'masked-password', 1)
step('snapshot', resolve(output, 'login.png')); step('activate', '[Enter] Save / continue')
step('expect', 'Local -> Cloud'); step('expect', 'Cloud -> Local')
step('absent', 'Link this device'); step('absent', 'Synchronize now'); step('absent', 'Conflicting files')
step('snapshot', resolve(output, 'cloud.png'))
step('activate', 'Account / recovery'); step('expect', 'Restore a previous copy')
step('snapshot', resolve(output, 'cloud-tools.png')); step('activate', 'Back')
step('activate', 'Local -> Cloud'); step('expect', 'Replace cloud saves')
step('snapshot', resolve(output, 'cloud-upload.png')); step('activate', 'Cancel')
step('activate', 'Local -> Cloud'); step('activate', 'Upload local saves')
step('expect', 'Local -> Cloud complete'); step('escape')
step('activate', 'Cloud -> Local'); step('expect', "Replace this device's saves")
step('snapshot', resolve(output, 'cloud-download.png')); step('activate', 'Cancel')
step('activate', 'Cloud -> Local'); step('activate', 'Download cloud saves')
step('expect', 'Cloud -> Local complete'); step('escape'); step('activate', 'Back to main menu')
if (existsSync(fixture)) step('absent', 'HnsSmoke')
step('activate', '[F5] Export save backup'); step('escape')
step('expect', '[F2] Item drops'); step('complete')
const plan = resolve(profile, 'plan.json'); writeFileSync(plan, JSON.stringify({ report, steps }), 'utf8')
const codec = resolve(profile, 'codec.mjs')
await build({ entryPoints: [resolve(root, 'src/offline/save-transfer.ts')], outfile: codec,
  bundle: true, platform: 'node', target: 'node22', format: 'esm', define: { 'import.meta.env': '{}' } })
const { packSave, unpackSave } = await import(pathToFileURL(codec).href)
const version = JSON.parse(readFileSync(resolve(root, 'build/desktop-source/web/offline/version.json'), 'utf8'))
const remotePack = rate => Buffer.from(packSave([
  { path: '/crawl/init.txt', mode: 0o100664, mtimeMs: 1000, data: new TextEncoder().encode(`hns_floor_item_rate = ${rate}\n`) },
  { path: '/crawl/cloud-only.txt', mode: 0o100664, mtimeMs: 1000, data: new TextEncoder().encode('cloud copy') },
], { exportedAt: '', build: version.build })).toString('base64')
const executablePath = process.env.HNS_DESKTOP_EXECUTABLE
const instance = await electron.launch({ executablePath, args: executablePath ? [] : [resolve(root, 'build/desktop-source')],
  env: { ...process.env, HNS_DESKTOP_DATA: profile, HNS_DESKTOP_MANAGEMENT: '', HNS_DESKTOP_UI_TEST: plan } })
let pid
const logs = []
instance.process().stderr?.on('data', chunk => { logs.push(chunk.toString('utf8')) })
let closed = false
instance.on('close', () => { closed = true })
try {
  const page = await instance.firstWindow()
  // 실제 서버 요청을 차단하고 일회용 프로필 안에서만 검사합니다.
  await instance.context().route('**/rest/v1/rpc/**', route => route.abort())
  await page.evaluate(({ changed, incoming }) => {
    const originalFetch = window.fetch.bind(window)
    const state = { reads: 0, uploads: [], data: '' }
    window.__hnsCloudTest = state
    window.fetch = async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url)
      if (url.origin === location.origin) return originalFetch(input, init)
      const name = url.pathname.split('/').pop()
      const args = JSON.parse(await request.text())
      if (name === 'hns_login') return Response.json('tester')
      if (name === 'hns_read_save') {
        state.reads++
        // 로그인 직후 자동 업로드, 수동 업로드, 수동 다운로드를 순서대로 검증합니다.
        if (state.reads === 4) state.data = changed
        if (state.reads === 7) state.data = incoming
        return Response.json(state.data)
      }
      if (name === 'hns_write_save') {
        const raw = Uint8Array.from(atob(state.data), ch => ch.charCodeAt(0))
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), b => b.toString(16).padStart(2, '0')).join('')
        if (args.p_expected !== hash) return Response.json({ error: 'HNS_SAVE_CHANGED' }, { status: 409 })
        state.data = args.p_data
        state.uploads.push(args.p_data)
        return new Response(null, { status: 204 })
      }
      throw new Error('External network requests are disabled in desktop menu tests')
    }
  }, { changed: remotePack(999), incoming: remotePack(125) })
  page.on('pageerror', error => logs.push(error.message))
  page.on('console', message => { if (message.type() === 'error') logs.push(message.text()) })
  await expect(page.locator('body')).toHaveText('')
  assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false)
  assert.equal(await page.evaluate(async () => (await fetch('/index.html')).ok), false, 'Mobile entry must not be shipped in PC packages')
  await instance.evaluate(({ dialog }, paths) => {
    let exports = 0
    dialog.showSaveDialog = async options => {
      if (!/[\\/]dcss-hns-\d{4}-\d{2}-\d{2}\.pzsave$/.test(options.defaultPath)) throw new Error('Backup filename must use DCSS HNS branding')
      return { canceled: false, filePath: exports++ ? paths.downloaded : paths.exported }
    }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.fixture] })
  }, { exported, downloaded, fixture })
  if (existsSync(fixture)) {
    assert.equal(await page.evaluate(bytes => window.HnsDesktop.checkSaveCompatibility(new Uint8Array(bytes)),
      Array.from(readFileSync(fixture))), true, 'The actual SDL engine must accept the Android fixture format')
  }
  const invalid = packSave([{ path: '/crawl/saves/Broken.cs', mode: 0o100664, mtimeMs: 1, data: new Uint8Array([1, 2, 3]) }], { exportedAt: '' })
  assert.equal(await page.evaluate(bytes => window.HnsDesktop.checkSaveCompatibility(new Uint8Array(bytes)), Array.from(invalid)), false,
    'Invalid native save formats must remain blocked')
  const active = resolve(profile, 'native/active.json')
  await expect.poll(() => existsSync(active) && JSON.parse(readFileSync(active, 'utf8')).pid, { timeout: 30000 }).toBeTruthy()
  pid = JSON.parse(readFileSync(active, 'utf8')).pid
  await expect.poll(() => existsSync(report) || closed, { timeout: 180000 }).toBe(true)
  assert.equal(existsSync(report), true, 'Native menu test stopped before completion: ' + logs.join('\n'))
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).ok, true)
  const files = unpackSave(readFileSync(exported)).files
  assert.match(new TextDecoder().decode(files.find(file => file.path === '/crawl/init.txt').data), /hns_floor_item_rate = 450/)
  if (existsSync(fixture)) {
    const original = unpackSave(readFileSync(fixture)).files.find(file => file.path === '/crawl/saves/HnsSmoke.cs')
    assert.deepEqual(files.find(file => file.path === original.path).data, original.data)
  }
  const mock = await page.evaluate(() => window.__hnsCloudTest)
  assert.equal(mock.uploads.length, 2, 'Signing in must auto-upload once; only the confirmed manual upload may write again')
  assert.equal(mock.reads, 8, 'Cancelled copies must not contact the cloud')
  assert.equal(unpackSave(Buffer.from(mock.uploads[1], 'base64')).files.some(file => file.path === '/crawl/cloud-only.txt'), false,
    'Local -> Cloud must replace the cloud set instead of merging cloud-only files')
  const restored = unpackSave(readFileSync(downloaded)).files
  assert.match(new TextDecoder().decode(restored.find(file => file.path === '/crawl/init.txt').data), /hns_floor_item_rate = 125/)
  assert.equal(restored.some(file => file.path === '/crawl/cloud-only.txt'), true)
  assert.equal(restored.some(file => file.path.endsWith('HnsSmoke.cs')), false)
  assert.equal(instance.windows().length <= 1, true, 'Management must use the original SDL window')
  console.log('PASS: original SDL menus, automatic cloud upload, directional copies and cancellation, masked password, settings and backup import/export')
} catch (error) {
  console.error(logs.join('\n'))
  for (const suffix of ['.progress', '.stderr']) {
    if (existsSync(plan + suffix)) console.error(readFileSync(plan + suffix, 'utf8'))
  }
  throw error
} finally {
  if (existsSync(report) && !closed) {
    writeFileSync(plan + '.done', '', 'utf8')
    await expect.poll(() => closed, { timeout: 10_000 }).toBe(true).catch(() => {})
  }
  if (pid && !closed) { try { process.kill(pid) } catch {} }
  await instance.close().catch(() => {})
  if (process.env.HNS_DESKTOP_KEEP_TEST_PROFILE) console.log('Native menu test profile:', profile)
  else rmSync(profile, { recursive: true, force: true })
}
