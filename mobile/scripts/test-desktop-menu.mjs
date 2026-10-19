import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const profile = mkdtempSync(resolve(tmpdir(), 'hns-standalone-menu-'))
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
  step('activate', '[F6] Import save backup'); step('activate', 'Enter full path'); step('fill', fixture, 0); step('enter'); step('escape'); step('expect', 'HnsSmoke')
}
step('activate', '[F2] Item drops'); step('activate', 'Edit drop settings')
step('fill', '4.5', 0); step('fill', '5', 6); step('snapshot', resolve(output, 'drops.png'))
step('activate', '[Enter] Save / continue'); step('escape')
step('expect', '[F3] Options file')
steps.push({ kind: 'expect-settings', values: { hns_floor_item_rate: 450, hns_consumable_amount: 500 } })
step('activate', '[F3] Options file')
step('expect', 'hns_floor_item_rate = 450'); step('snapshot', resolve(output, 'options.png'))
step('activate', 'Discard changes')
step('activate', '[F5] Export save backup'); step('activate', 'Enter full path'); step('fill', exported, 0); step('enter'); step('escape')
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
steps.push({ kind: 'expect-settings', values: { hns_floor_item_rate: 125 } })
step('activate', '[F5] Export save backup'); step('activate', 'Enter full path'); step('fill', downloaded, 0); step('enter'); step('escape')
step('expect', '[F2] Item drops'); step('complete')

const plan = resolve(profile, 'plan.json'); writeFileSync(plan, JSON.stringify({ report, steps }), 'utf8')
const codec = resolve(profile, 'codec.mjs')
await build({ entryPoints: [resolve(root, 'src/offline/save-transfer.ts')], outfile: codec,
  bundle: true, platform: 'node', target: 'node22', format: 'esm', define: { 'import.meta.env': '{}' } })
const { packSave, unpackSave } = await import(pathToFileURL(codec).href)
const executable = process.env.HNS_DESKTOP_EXECUTABLE
if (!executable) throw new Error('Set HNS_DESKTOP_EXECUTABLE to the standalone SDL executable or Linux wrapper')
const state = { reads: 0, uploads: [], raw: Buffer.alloc(0) }
const remotePack = rate => Buffer.from(packSave([
  { path: '/crawl/init.txt', mode: 0o100664, mtimeMs: 1000, data: new TextEncoder().encode(`hns_floor_item_rate = ${rate}\n`) },
  { path: '/crawl/cloud-only.txt', mode: 0o100664, mtimeMs: 1000, data: new TextEncoder().encode('cloud copy') },
], { exportedAt: '', build: 'native-test' }))
const server = createServer(async (request, response) => {
  try {
    let body = ''; for await (const chunk of request) body += chunk
    const args = JSON.parse(body), name = request.url.split('/').pop()
    assert.equal(args.p_id, 'tester')
    assert.equal(args.p_password, createHash('sha256').update('DCSS-HNS-login-v1\0tester\0masked-password').digest('hex'))
    response.setHeader('Content-Type', 'application/json')
    if (name === 'hns_login') return response.end(JSON.stringify('tester'))
    if (name === 'hns_read_save') {
      state.reads++
      if (state.reads === 4) state.raw = remotePack(999)
      if (state.reads === 7) state.raw = remotePack(125)
      return response.end(JSON.stringify(state.raw.toString('base64')))
    }
    if (name === 'hns_write_save') {
      assert.equal(args.p_expected, createHash('sha256').update(state.raw).digest('hex'))
      state.raw = Buffer.from(args.p_data, 'base64'); state.uploads.push(state.raw)
      response.writeHead(204); return response.end()
    }
    throw new Error('Unexpected cloud RPC')
  } catch { response.writeHead(500); response.end(JSON.stringify({error:'TEST_FAILED'})) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const child = spawn(executable, [], { env: { ...process.env, HNS_DESKTOP_DATA: profile, HNS_DESKTOP_UI_TEST: plan,
  HNS_NATIVE_TEST_CLOUD: `http://127.0.0.1:${server.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] })
let closed = false, logs = ''
child.on('exit', () => { closed = true }); child.on('error', error => { logs += error.message; closed = true })
child.stdout.on('data', chunk => { logs += chunk }); child.stderr.on('data', chunk => { logs += chunk })
async function wait(predicate, timeout = 120_000) {
  const deadline = Date.now() + timeout
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Standalone SDL test timed out'); await delay(100) }
}
try {
  await wait(() => existsSync(report) || closed)
  assert.equal(existsSync(report), true, 'Standalone SDL exited before completion: ' + logs)
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).ok, true)
  const files = unpackSave(readFileSync(exported)).files
  assert.match(new TextDecoder().decode(files.find(file => file.path === '/crawl/init.txt').data), /hns_floor_item_rate = 450/)
  if (existsSync(fixture)) {
    const original = unpackSave(readFileSync(fixture)).files.find(file => file.path === '/crawl/saves/HnsSmoke.cs')
    assert.deepEqual(files.find(file => file.path === original.path).data, original.data)
  }
  assert.equal(state.uploads.length, 2, 'Only login auto-upload and confirmed manual upload may write')
  assert.equal(state.reads, 8, 'Cancelled copies must not contact the cloud')
  const restored = unpackSave(readFileSync(downloaded)).files
  assert.match(new TextDecoder().decode(restored.find(file => file.path === '/crawl/init.txt').data), /hns_floor_item_rate = 125/)
  assert.equal(restored.some(file => file.path === '/crawl/cloud-only.txt'), true)
  assert.equal(restored.some(file => file.path.endsWith('HnsSmoke.cs')), false)
  assert.equal(unpackSave(state.uploads[1]).files.some(file => file.path === '/crawl/cloud-only.txt'), false)
  writeFileSync(plan + '.done', '')
  await wait(() => closed, 15_000)
  console.log('PASS: standalone SDL menus, in-game file picker, settings, Android backup roundtrip, cloud login, automatic upload, directional copies, cancellation and password masking')
} catch (error) {
  writeFileSync(resolve(output, 'native.stderr'), logs)
  if (existsSync(plan + '.progress')) { copyFileSync(plan + '.progress', resolve(output, 'native.progress')); console.error(readFileSync(plan + '.progress', 'utf8')) }
  console.error(logs); throw error
} finally {
  if (!closed) child.kill()
  await new Promise(resolve => server.close(resolve))
  if (process.env.HNS_DESKTOP_KEEP_TEST_PROFILE) console.log('Standalone test profile:', profile)
  else rmSync(profile, { recursive: true, force: true })
}
