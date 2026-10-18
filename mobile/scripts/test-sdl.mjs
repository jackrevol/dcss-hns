import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(process.argv[2] || process.env.HNS_DESKTOP_DIR ||
  resolve(root, 'build/sdl/native'))
const manifest = JSON.parse(readFileSync(resolve(output, 'desktop.json'), 'utf8'))
assert.equal(manifest.client, 'sdl-tiles')
assert.equal(manifest.platform, process.platform)
assert.equal(manifest.arch, process.arch)
const binary = resolve(output, manifest.binary), data = resolve(output, manifest.data)
assert.ok(existsSync(binary), 'Native executable is missing')
for (const file of ['dat/tiles/floor.png', 'settings/init.txt']) {
  assert.ok(existsSync(resolve(data, file)), `Packaged game data is missing: ${file}`)
}
for (const name of ['DejaVuSans.ttf', 'DejaVuSansMono.ttf']) {
  assert.ok(existsSync(resolve(output, manifest.fonts, name)), `Packaged font is missing: ${name}`)
}
assert.ok(!existsSync(resolve(output, 'resources/app.asar')), 'Mobile Electron shell must not be packaged')
const profile = mkdtempSync(resolve(tmpdir(), 'hns-desktop-test-'))
try {
  const rc = resolve(profile, 'init.txt')
  writeFileSync(rc, `save_dir = ${profile.replaceAll('\\', '/')}/saves\n` +
    `morgue_dir = ${profile.replaceAll('\\', '/')}/morgue\n`, 'utf8')
  const run = args => execFileSync(binary, args, { cwd: data, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, CRAWL_DIR: profile,
      ...(process.platform === 'linux' ? { LD_LIBRARY_PATH: resolve(output, 'AppDir/usr/lib') } : {}) } })
  const version = run(['-version'])
  assert.match(version, /Crawl version .*hns/)
  if (manifest.version) assert.ok(version.includes(manifest.version), 'Displayed native version must match the release')
  assert.match(version, /-DUSE_TILE_LOCAL\b/)
  assert.match(version, /-DUSE_SDL\b/)
  assert.doesNotMatch(version, /-DUSE_TILE_WEB\b/)
  run(['-headless', '-builddb'])
  console.log('PASS: original SDL tiles client, HNS engine, packaged tiles/fonts/settings, offline database initialization')
} finally {
  rmSync(profile, { recursive: true, force: true })
}
