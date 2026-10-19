import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('..', import.meta.url))
const native = resolve(root, 'build/sdl/native')
const manifest = JSON.parse(readFileSync(resolve(native, 'desktop.json'), 'utf8'))
assert.equal(manifest.standalone, true)
const executable = process.env.HNS_DESKTOP_EXECUTABLE
assert.ok(executable && existsSync(executable), 'Set the packaged SDL executable')
const directory = process.platform === 'darwin' ? resolve(executable, '../../..') : resolve(executable, '..')
const visit = path => {
  for (const file of readdirSync(path, {withFileTypes:true})) {
    assert.doesNotMatch(file.name, /^(?:app\.asar|Electron(?: Framework)?|desktop-service\.html)$/i, 'Browser/launcher runtime must not be packaged')
    if(file.isDirectory()) visit(resolve(path,file.name))
  }
}
visit(directory)
execFileSync(process.execPath, [resolve(root, 'scripts/test-sdl.mjs'), native], { stdio: 'inherit' })
await import('./test-desktop-menu.mjs')
