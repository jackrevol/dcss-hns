import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url))
const native = resolve(root, 'build/sdl/native')
const manifest = JSON.parse(readFileSync(resolve(native, 'desktop.json'), 'utf8'))
assert.equal(manifest.client, 'sdl-tiles')
assert.ok(existsSync(resolve(native, manifest.binary)))
const web = resolve(root, 'build/desktop-source/web')
const checkWeb = (directory, prefix = '') => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name, path = resolve(directory, entry.name)
    if (entry.isDirectory()) { checkWeb(path, name + '/'); continue }
    assert.match(name, /^(?:desktop-service\.html|assets\/desktop-service-[\w-]+\.js|offline\/version\.json|desktop-assets\/icon\.png|_headers|(?:LICENSE|ATTRIBUTION\.md|ENGINE-LICENSE)\.txt)$/,
      `Unexpected asset in PC save service: ${name}`)
  }
}
checkWeb(web)
execFileSync(process.execPath, [resolve(root, 'scripts/test-sdl.mjs'), native], { stdio: 'inherit' })
await import('./test-desktop-menu.mjs')
