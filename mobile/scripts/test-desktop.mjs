import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url)), profile = mkdtempSync(resolve(tmpdir(), 'hns-desktop-test-'))
const codecPath = resolve(profile, 'codec.mjs')
await build({ entryPoints: [resolve(root, 'src/offline/save-transfer.ts')], outfile: codecPath,
  bundle: true, platform: 'node', target: 'node22', format: 'esm', define: { 'import.meta.env': '{}' } })
const { packSave, unpackSave } = await import(pathToFileURL(codecPath).href)
const fixture = process.env.HNS_DESKTOP_PACK || resolve(root, 'test-results/offline-backup.pzsave')
const bytes = existsSync(fixture) ? readFileSync(fixture) : packSave([
  { path: '/crawl/saves/HnsSmoke.cs', mode: 0o100664, mtimeMs: Date.now(), data: new Uint8Array([1, 2, 3]) },
  { path: '/crawl/init.txt', mode: 0o100664, mtimeMs: Date.now(), data: new TextEncoder().encode('hns_item_quality = 200\n') },
], { exportedAt: new Date().toISOString() })
const imported = resolve(profile, 'test.pzsave'); writeFileSync(imported, bytes)
const executablePath = process.env.HNS_DESKTOP_EXECUTABLE
const instance = await electron.launch({ executablePath, args: executablePath ? [] : [resolve(root, 'build/desktop-source')],
  env: { ...process.env, HNS_DESKTOP_DATA: profile, HNS_DESKTOP_MANAGEMENT: '1' } })
try {
  const page = await instance.firstWindow(), errors = []
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(30_000)
  await expect(page.locator('#desktop-manager')).toBeVisible()
  await page.bringToFront()
  await expect(page.locator('#lobby-view, #game-view, #offline-new')).toHaveCount(0)
  assert.equal(await page.evaluate(() => isSecureContext), true)
  assert.equal(await page.evaluate(() => window.HnsDesktop.native), true)
  const releaseVersion = await page.evaluate(() => window.HnsDesktop.version)
  assert.match(releaseVersion, /^\d+\.\d+-a\d+-hns\.\d+$/)
  await expect(page.locator('#desktop-version')).toHaveText(releaseVersion)
  assert.deepEqual(Buffer.from(await page.evaluate(async () => [...new Uint8Array(await (await fetch('/desktop-assets/icon.png')).arrayBuffer())])),
    readFileSync(resolve(root, '../crawl-ref/source/dat/tiles/stone_soup_icon-512x512.png')))
  // 관리 기능만 웹에 있으며 모바일 게임 엔진은 패키지에 포함하지 않습니다.
  assert.equal(await page.evaluate(async () => (await fetch('/offline/crawl.wasm.gz')).ok), false)
  await instance.context().route('**/*', route => route.request().url().startsWith('https://appassets.dcsshns.invalid/') ? route.continue() : route.abort())
  await page.locator('#desktop-cloud').click()
  await expect(page.locator('#cloud-login-form')).toBeVisible()
  await expect(page.getByLabel('아이디', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  const chooser = page.waitForEvent('filechooser')
  await page.locator('#desktop-import').click()
  await (await chooser).setFiles(imported)
  await expect(page.locator('#desktop-save-summary')).toContainText('HnsSmoke')
  await page.keyboard.press('d')
  await expect(page.getByRole('dialog', { name: '아이템 드랍 설정' })).toBeVisible()
  await page.getByRole('spinbutton', { name: '바닥 아이템 생성량', exact: true }).fill('4.5')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.locator('#desktop-notice')).toContainText('저장했습니다')
  const path = resolve(profile, 'export.pzsave')
  await instance.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, path)
  await page.locator('#desktop-export').click()
  await expect(page.locator('#desktop-notice')).toContainText('백업을 내보냈습니다')
  const restored = unpackSave(readFileSync(path)).files
  const originalSave = unpackSave(bytes).files.find(file => file.path === '/crawl/saves/HnsSmoke.cs')
  assert.deepEqual(restored.find(file => file.path === originalSave.path).data, originalSave.data)
  assert.match(new TextDecoder().decode(restored.find(file => file.path === '/crawl/init.txt').data), /hns_floor_item_rate = 450/)
  await page.reload()
  await expect(page.locator('#desktop-save-summary')).toContainText('HnsSmoke')
  await page.locator('#desktop-loot').click()
  await expect(page.getByRole('spinbutton', { name: '바닥 아이템 생성량', exact: true })).toHaveValue('4.5')
  await page.keyboard.press('Escape')
  mkdirSync(resolve(root, 'test-results'), { recursive: true })
  await page.screenshot({ path: resolve(root, 'test-results/desktop-management.png') })
  const native = await instance.evaluate(({ app }) => app.isPackaged ? process.resourcesPath + '/native' : undefined)
  const nativeDir = native || resolve(root, 'build/sdl/native')
  assert.equal(JSON.parse(readFileSync(resolve(nativeDir, 'desktop.json'), 'utf8')).version, releaseVersion)
  execFileSync(process.execPath, [resolve(root, 'scripts/test-sdl.mjs'), nativeDir], { stdio: 'inherit' })
  if (existsSync(fixture)) {
    const manifest = JSON.parse(readFileSync(resolve(nativeDir, 'desktop.json'), 'utf8'))
    const saved = resolve(profile, 'HnsSmoke.cs'); writeFileSync(saved, originalSave.data)
    const version = execFileSync(resolve(nativeDir, manifest.binary), ['-save-version', saved], { encoding: 'utf8' })
    assert.match(version, /Save file version for .* is \d+\.\d+/)
  }
  assert.deepEqual(errors, [])
  console.log('PASS: original SDL engine and PC management UI, shared loot settings, persistent save import/export, cloud UI, offline local assets')
} catch (error) {
  const page = instance.windows()[0]
  if (page) console.error('DESKTOP_FAILURE', await page.locator('body').innerText())
  throw error
} finally { await instance.close(); rmSync(profile, { recursive: true, force: true }) }
