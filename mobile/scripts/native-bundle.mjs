import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export function sourceCommit(mobile) {
  const repository = resolve(mobile, '..')
  if (!existsSync(resolve(repository, '.git'))) return undefined
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
}

export function readNativeBundle(directory, expected) {
  const root = resolve(directory)
  const manifest = JSON.parse(readFileSync(resolve(root, 'desktop.json'), 'utf8'))
  for (const [key, value] of Object.entries({ client: 'sdl-tiles', ...expected })) {
    if (manifest[key] !== value) throw new Error(`Native bundle ${key} mismatch: expected ${value}, got ${manifest[key]}`)
  }
  for (const key of ['binary', 'data', 'fonts']) {
    if (typeof manifest[key] !== 'string' || !manifest[key]) throw new Error(`Missing native bundle ${key}`)
    const path = resolve(root, manifest[key])
    if (path !== root && !path.startsWith(root + sep)) throw new Error(`Native bundle ${key} is outside its directory`)
    const info = statSync(path)
    if (!(key === 'binary' ? info.isFile() : info.isDirectory())) throw new Error(`Invalid native bundle ${key}`)
  }
  for (const path of [
    resolve(root, manifest.data, 'dat/tiles/floor.png'),
    resolve(root, manifest.data, 'settings/init.txt'),
    ...['DejaVuSans.ttf', 'DejaVuSansMono.ttf'].map(name => resolve(root, manifest.fonts, name)),
  ]) {
    if (!statSync(path).isFile()) throw new Error(`Invalid native bundle file: ${path}`)
  }
  return manifest
}
