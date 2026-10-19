// Real engine smoke test: no public server, no fake engine or golden replay.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { chromium, expect } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidence = resolve(root, 'test-results')
mkdirSync(evidence, { recursive: true })
const origin = 'http://127.0.0.1:4173'
const server = spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
  { cwd: root, stdio: 'inherit' })
let browser
let page
const errors = []
const keys = text => page.evaluate(text => window.__pzEngine.sendKeys(text), text)
const bodyContains = text => expect(page.locator('body')).toContainText(text, { timeout: 30_000 })

async function choose(label) {
  const item = page.locator('button[data-hotkey]')
    .filter({ has: page.getByText(label, { exact: true }) }).first()
  await expect(item).toBeVisible()
  if (!await item.evaluate(el => el.classList.contains('ngv-sel'))) await item.tap()
  await item.tap()
}

try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Preview server failed to start')
    try { ready = (await fetch(origin)).ok } catch { /* server is starting */ }
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(ready, 'Preview server did not become ready')
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  await context.addInitScript(() => {
    let engine
    window.__hnsLootOptions = []
    Object.defineProperty(window, '__pzEngine', {
      configurable: true,
      get: () => engine,
      set: port => {
        engine = port
        // MiniServer installs its output callback at start(), after the
        // diagnostic port is published. Wrap only after that assignment.
        const start = port.start
        port.start = function () {
          const deliver = port.onOutput
          let pending = ''
          port.onOutput = chunk => {
            pending += chunk
            const lines = pending.split('\n')
            pending = lines.pop()
            for (const line of lines) {
              try {
                const message = JSON.parse(line)
                if (message.options?.hns_loot) window.__hnsLootOptions.push(message.options.hns_loot)
              } catch { /* starred server lines */ }
            }
            deliver(chunk)
          }
          return start.call(port)
        }
      },
    })
  })
  // No external connection can satisfy a missing engine/tile dependency.
  await context.route('**/*', route => route.request().url().startsWith(origin)
    ? route.continue() : route.abort())
  page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/?offline=1&jspi=0`)
  const version = await page.evaluate(async () => (await fetch('/offline/version.json')).json())
  assert.equal(version.hns, true)
  await page.locator('#offline-loot').tap()
  await expect(page.locator('input[name="hns_floor_item_rate"]')).toHaveValue('3')
  await expect(page.locator('input[name="hns_item_quality"]')).toHaveValue('2')
  await page.getByRole('button', { name: '원본 드랍값', exact: true }).tap()
  await expect(page.locator('input[name="hns_floor_item_rate"]')).toHaveValue('1')
  await page.getByRole('button', { name: 'HNS 기본값', exact: true }).tap()
  const chosenLoot = {
    hns_floor_item_rate: 350, hns_item_quality: 175, hns_item_min_level: 20,
    hns_good_item_chance: 75, hns_randart_chance: 100,
    hns_gold_amount: 200, hns_consumable_amount: 300,
  }
  for (const [name, value] of Object.entries(chosenLoot)) {
    const scale = ['hns_floor_item_rate', 'hns_item_quality', 'hns_gold_amount', 'hns_consumable_amount'].includes(name) ? 100 : 1
    await page.locator(`input[name="${name}"]`).fill(String(value / scale))
  }
  await page.locator('.hns-loot-settings').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: resolve(evidence, 'loot-settings.png') })
  await page.locator('input[name="hns_consumable_amount"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, 'loot-settings-quantities.png') })
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await bodyContains('아이템 드랍 설정을 저장했습니다.')
  await page.locator('#offline-new').tap()
  await page.locator('#offline-name').fill('HnsSmoke')
  await page.locator('#offline-name-form button[type=submit]').tap()
  await bodyContains('Please select your species')
  await choose('Minotaur')
  await bodyContains('Please select your background')
  await choose('Fighter')
  await bodyContains('choice of weapons')
  await choose('war axe')
  await bodyContains('HnsSmoke the Shield-Bearer')
  await bodyContains('19/19')
  await expect.poll(() => page.evaluate(() => window.__hnsLootOptions.at(-1)), { timeout: 10_000 })
    .toEqual(chosenLoot)
  await page.screenshot({ path: resolve(evidence, 'offline-ascii.png') })

  await page.locator('.hud-settings-chip').tap()
  await page.getByRole('radio', { name: 'Tiles', exact: true }).tap()
  await page.locator('.settings-card .doc-close').tap()
  await expect(page.locator('.settings-card')).toHaveCount(0)
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.screenshot({ path: resolve(evidence, 'offline-tiles.png') })

  // Check the HNS-only prompt and exception-driven reload through WASM.
  // 시작 지형이 닫힌 입구여도 몬스터가 반드시 접근할 수 있게 준비합니다.
  // 전투·사망·부활은 계속 실제 엔진으로 검증합니다.
  await keys('&')
  await bodyContains('Confirm with "wiz"')
  await keys('wiz\r')
  await bodyContains('Enter Wizard Command')
  await keys('\u0014') // 원본 위저드의 DLua 인터프리터
  await bodyContains('[Hit ESC to exit interpreter.]')
  await keys('local x,y=you.pos(); for dx=-1,1 do for dy=-1,1 do if dx~=0 or dy~=0 then dgn.terrain_changed(x+dx,y+dy,"floor",false,false) end end end; return "HNS smoke arena ready"\r')
  await bodyContains('HNS smoke arena ready')
  await keys('\u001b&m')
  await bodyContains('Enter monster name')
  await keys('executioner\r')
  await bodyContains('You encounter an Executioner')
  for (let turn = 0; turn < 30; turn++) {
    await keys('.')
    // Send one turn at a time: queued dots would answer "No" to Die?.
    await page.waitForTimeout(150)
    const text = await page.locator('body').innerText()
    if (text.includes('Die?')) break
    if (text.includes('--more--')) await keys(' ')
  }
  await bodyContains('Die?')
  await keys('Y')
  await bodyContains('Revive at the last level entry?')
  await keys('Y')
  await bodyContains('You return to your last level entry. Welcome back!')
  await bodyContains('19/19')
  await page.screenshot({ path: resolve(evidence, 'hns-revival.png') })

  // Checkpoint, then destroy the whole page/worker and resume from IndexedDB.
  await keys('.')
  await page.evaluate(() => {
    window.__hnsCheckpoint = false
    const deliver = window.__pzEngine.onOutput
    window.__pzEngine.onOutput = chunk => {
      if (chunk.includes('*{"msg":"checkpoint"}')) window.__hnsCheckpoint = true
      deliver(chunk)
    }
    window.dispatchEvent(new Event('hns-background'))
  })
  await expect.poll(() => page.evaluate(() => window.__hnsCheckpoint), { timeout: 10_000 }).toBe(true)
  await page.goto(`${origin}/?offline=1&jspi=0`)
  await page.locator('.offline-slot-row').first().tap()
  await bodyContains('Welcome back, HnsSmoke')
  await keys('S')
  await bodyContains('Save game and exit?')
  await keys('Y')
  await expect(page.locator('#offline-export')).toBeVisible()

  const downloadReady = page.waitForEvent('download')
  await page.locator('#offline-export').tap()
  const download = await downloadReady
  const backup = resolve(evidence, 'offline-backup.pzsave')
  await download.saveAs(backup)
  assert(statSync(backup).size > 0)
  await bodyContains('Backup exported.')

  const imported = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  await imported.route('**/*', route => route.request().url().startsWith(origin)
    ? route.continue() : route.abort())
  page = await imported.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/?offline=1&jspi=0`)
  const picker = page.waitForEvent('filechooser')
  await page.locator('#offline-import').tap()
  await (await picker).setFiles(backup)
  await bodyContains('Restored backup')
  await expect(page.locator('.offline-slot-row')).toContainText('HnsSmoke')
  await page.locator('#offline-loot').tap()
  await expect(page.locator('input[name="hns_floor_item_rate"]')).toHaveValue('3.5')
  await expect(page.locator('input[name="hns_consumable_amount"]')).toHaveValue('3')
  await page.locator('.settings-card .doc-close').tap()
  await page.locator('.offline-slot-row').tap()
  await bodyContains('Welcome back, HnsSmoke')
  assert.deepEqual(errors, [], 'Unexpected browser errors')
  rmSync(resolve(evidence, 'offline-failure.png'), { force: true })
  console.log('PASS: HNS engine, touch character creation, ASCII/tiles, combat death/revival, loot settings applied by C++ engine, checkpoint/resume, backup export/import')
} catch (error) {
  if (page) {
    console.error((await page.locator('body').innerText()).trim().slice(-2500))
    await page.screenshot({ path: resolve(evidence, 'offline-failure.png') }).catch(() => {})
  }
  throw error
} finally {
  await browser?.close()
  server.kill()
}
