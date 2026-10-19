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
const report = resolve(profile, 'report.json'), exported = resolve(profile, 'export.pzsave')
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
step('activate', '[F7] Cloud saves'); step('expect', 'Sign in'); step('snapshot', resolve(output, 'cloud.png'))
step('activate', 'Sign in'); step('fill', 'Tester', 0); step('fill', 'masked-password', 1)
step('snapshot', resolve(output, 'login.png')); step('escape'); step('escape')
step('expect', '[F2] Item drops'); step('complete')
const plan = resolve(profile, 'plan.json'); writeFileSync(plan, JSON.stringify({ report, steps }), 'utf8')
const codec = resolve(profile, 'codec.mjs')
await build({ entryPoints: [resolve(root, 'src/offline/save-transfer.ts')], outfile: codec,
  bundle: true, platform: 'node', target: 'node22', format: 'esm', define: { 'import.meta.env': '{}' } })
const { unpackSave } = await import(pathToFileURL(codec).href)
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
  page.on('pageerror', error => logs.push(error.message))
  page.on('console', message => { if (message.type() === 'error') logs.push(message.text()) })
  await expect(page.locator('body')).toHaveText('')
  assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false)
  assert.equal(await page.evaluate(async () => (await fetch('/index.html')).ok), false, 'Mobile entry must not be shipped in PC packages')
  await instance.evaluate(({ dialog }, paths) => {
    dialog.showSaveDialog = async options => {
      if (!/[\\/]dcss-hns-\d{4}-\d{2}-\d{2}\.pzsave$/.test(options.defaultPath)) throw new Error('Backup filename must use DCSS HNS branding')
      return { canceled: false, filePath: paths.exported }
    }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.fixture] })
  }, { exported, fixture })
  const active = resolve(profile, 'native/active.json')
  await expect.poll(() => existsSync(active) && JSON.parse(readFileSync(active, 'utf8')).pid, { timeout: 30000 }).toBeTruthy()
  pid = JSON.parse(readFileSync(active, 'utf8')).pid
  await expect.poll(() => existsSync(report) || closed, { timeout: 120000 }).toBe(true)
  assert.equal(existsSync(report), true, 'Native menu test stopped before completion: ' + logs.join('\n'))
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).ok, true)
  const files = unpackSave(readFileSync(exported)).files
  assert.match(new TextDecoder().decode(files.find(file => file.path === '/crawl/init.txt').data), /hns_floor_item_rate = 450/)
  if (existsSync(fixture)) {
    const original = unpackSave(readFileSync(fixture)).files.find(file => file.path === '/crawl/saves/HnsSmoke.cs')
    assert.deepEqual(files.find(file => file.path === original.path).data, original.data)
  }
  assert.equal(instance.windows().length <= 1, true, 'Management must use the original SDL window')
  console.log('PASS: all six menus in original SDL main window, native forms, masked password, shared drop settings and backup import/export')
} catch (error) {
  console.error(logs.join('\n'))
  for (const suffix of ['.progress', '.stderr']) {
    if (existsSync(plan + suffix)) console.error(readFileSync(plan + suffix, 'utf8'))
  }
  throw error
} finally {
  if (pid) { try { process.kill(pid) } catch {} }
  await instance.close().catch(() => {})
  if (process.env.HNS_DESKTOP_KEEP_TEST_PROFILE) console.log('Native menu test profile:', profile)
  else rmSync(profile, { recursive: true, force: true })
}
