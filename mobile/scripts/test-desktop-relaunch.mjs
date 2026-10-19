// macOS 로컬 회귀 검사: 바깥 앱 종료 후 Dock이 기억한 내부 SDL 앱으로 재실행합니다.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

assert.equal(process.platform, 'darwin', 'Run this regression check locally on macOS')
const root = fileURLToPath(new URL('..', import.meta.url))
const app = resolve(process.env.HNS_DESKTOP_APP || resolve(root, 'build/desktop/DCSS HNS-darwin-arm64/DCSS HNS.app'))
const inner = resolve(app, 'Contents/Resources/native/DCSS HNS.app')
const binary = bundle => resolve(bundle, 'Contents/MacOS/DCSS HNS')
const bundleID = bundle => execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', resolve(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
assert.notEqual(bundleID(app), bundleID(inner), 'The launcher and SDL engine must have different app identities')
const temporary = mkdtempSync(resolve(tmpdir(), 'hns-relaunch-'))
const profile = resolve(temporary, 'profile'), crawl = resolve(profile, 'native/crawl')
const output = resolve(root, 'test-results/desktop-relaunch')
mkdirSync(output, { recursive: true })
const processes = () => execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n').flatMap(line => {
  const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
  return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : []
})
const owned = () => processes().filter(p => [binary(app), binary(inner)].some(path => p.command === path || p.command.startsWith(path + ' ')))
let launched = false
async function wait(predicate, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for macOS relaunch')
    await delay(100)
  }
}
try {
  assert.equal(owned().length, 0, 'Close this app before running its relaunch check')
  const codec = resolve(temporary, 'codec.mjs')
  await build({ entryPoints: [resolve(root, 'src/offline/save-transfer.ts')], outfile: codec,
    bundle: true, platform: 'node', target: 'node22', format: 'esm', define: { 'import.meta.env': '{}' } })
  const { unpackSave } = await import(pathToFileURL(codec).href)
  const fixture = process.env.HNS_DESKTOP_PACK || resolve(root, 'test-results/offline-backup.pzsave')
  const files = unpackSave(readFileSync(fixture)).files
  const character = files.find(file => file.path === '/crawl/saves/HnsSmoke.cs')
  assert.ok(character, 'Provide the HnsSmoke backup fixture')
  for (const file of files) {
    assert.ok(file.path.startsWith('/crawl/'))
    const target = resolve(crawl, file.path.slice('/crawl/'.length))
    assert.ok(target.startsWith(crawl + '/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.data)
  }
  // A previous native session awaiting recovery seeds the same persistent IDB.
  writeFileSync(resolve(profile, 'native/active.json'), JSON.stringify({ name: '' }))
  for (const [index, entry] of [app, inner, inner].entries()) {
    const report = resolve(temporary, `report-${index}.json`), plan = resolve(temporary, `plan-${index}.json`)
    const steps = []
    const step = (kind, value, field) => steps.push({ kind, value, index: field })
    step('expect', 'Loading complete, press any key to start.'); step('enter')
    for (const label of ['[F2] Item drops', '[F7] Cloud saves', 'HnsSmoke']) step('expect', label)
    if (index === 0) {
      step('activate', '[F2] Item drops'); step('activate', 'Edit drop settings')
      step('fill', '4.5', 0); step('activate', '[Enter] Save / continue'); step('escape')
    }
    step('activate', '[F3] Options file'); step('expect', 'hns_floor_item_rate = 450')
    step('snapshot', resolve(output, `options-${index}.png`)); step('activate', 'Discard changes')
    step('expect', '[F7] Cloud saves'); step('complete')
    writeFileSync(plan, JSON.stringify({ report, steps }))
    execFileSync('open', [entry, '--env', 'HNS_DESKTOP_DATA=' + profile, '--env', 'HNS_DESKTOP_UI_TEST=' + plan])
    launched = true
    await wait(() => existsSync(report))
    assert.equal(JSON.parse(readFileSync(report, 'utf8')).ok, true)
    const pid = JSON.parse(readFileSync(resolve(profile, 'native/active.json'), 'utf8')).pid
    const running = processes(), engine = running.find(p => p.pid === pid)
    assert.ok(engine?.command.startsWith(binary(inner)), 'The SDL engine must be running')
    assert.ok(running.some(p => p.pid === engine.parent && p.command.startsWith(binary(app))), 'The save service must own the SDL engine after reopening')
    assert.ok(engine.command.includes(resolve(crawl, 'init.txt')), 'Reopening must retain the same profile')
    assert.deepEqual(readFileSync(resolve(crawl, 'saves/HnsSmoke.cs')), Buffer.from(character.data))
    writeFileSync(plan + '.done', '')
    await wait(() => owned().length === 0, 20_000)
    assert.match(readFileSync(resolve(crawl, 'init.txt'), 'utf8'), /hns_floor_item_rate = 450/)
    console.log(`PASS: ${index === 0 ? 'outer app launch' : 'embedded app relaunch ' + index}, SDL menus, unchanged character save, persistent settings, save service ownership`)
  }
} finally {
  // Only disposable processes started by this isolated profile may be stopped.
  if (launched) for (const child of owned()) { try { process.kill(child.pid) } catch {} }
  console.log('Relaunch evidence:', output)
  if (process.env.HNS_DESKTOP_KEEP_TEST_PROFILE) console.log('Relaunch test profile:', temporary)
  else rmSync(temporary, { recursive: true, force: true })
}
