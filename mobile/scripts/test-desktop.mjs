import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url))
const native = resolve(root, 'build/sdl/native')
const manifest = JSON.parse(readFileSync(resolve(native, 'desktop.json'), 'utf8'))
assert.equal(manifest.client, 'sdl-tiles')
assert.ok(existsSync(resolve(native, manifest.binary)))
assert.equal(existsSync(resolve(root, 'build/desktop-source/web/index.html')), false, 'PC packages must not include the mobile entry')
execFileSync(process.execPath, [resolve(root, 'scripts/test-sdl.mjs'), native], { stdio: 'inherit' })
await import('./test-desktop-menu.mjs')
