// Gradle invokes this before packaging. Refuse incomplete/vanilla-engine APKs.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVersion } from './release-version.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const required = ['index.html', 'offline/version.json', 'offline/crawl.js',
  'offline/crawl.wasm.gz', 'offline/crawl.data.gz',
  'offline/prewarm/manifest.json', 'offline/prewarm/prewarm.bin.gz',
  'gamedata/local/manifest.json']
for (const file of required) {
  if (!existsSync(resolve(dist, file))) throw new Error(`Missing ${file}; run npm run build:engine && npm run build`)
}
const version = JSON.parse(readFileSync(resolve(dist, 'offline/version.json'), 'utf8'))
if (version.hns !== true) throw new Error('The APK must bundle the HNS engine built from this repository')
if (process.env.HNS_RELEASE_VERSION && version.version !== releaseVersion().version) throw new Error('APK and engine release versions must match')
const { files } = JSON.parse(readFileSync(resolve(dist, 'gamedata/local/manifest.json'), 'utf8'))
for (const file of files) {
  if (!/^[\w.-]+\.(js|png)$/.test(file) || !existsSync(resolve(dist, 'gamedata/local', file))) {
    throw new Error(`Missing or invalid tile asset: ${file}`)
  }
}
const output = resolve(root, 'android/app/build/generated/webAssets')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
cpSync(dist, resolve(output, 'www'), { recursive: true })
// Native builds serve APK assets directly. Never retain an old shell in a SW.
rmSync(resolve(output, 'www/sw.js'), { force: true })
cpSync(resolve(root, 'LICENSE'), resolve(output, 'www/LICENSE.txt'))
cpSync(resolve(root, '../LICENSE'), resolve(output, 'www/ENGINE-LICENSE.txt'))
cpSync(resolve(root, 'ATTRIBUTION.md'), resolve(output, 'www/ATTRIBUTION.md'))
console.log(`Bundled HNS engine ${version.build} (${version.version}) and ${files.length} tile assets`)
