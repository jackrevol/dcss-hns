// Include the working source snapshot and initialized dependency sources.
// git archive alone omits gitlinks and would lose the Lua used by the engine.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVersion } from './release-version.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const version = JSON.parse(readFileSync(resolve(root, 'mobile/public/offline/version.json'), 'utf8'))
if (version.hns !== true || !/^[a-f0-9]{12}$/.test(version.build)) throw new Error('Build the HNS engine first')
const outputDir = resolve(root, 'mobile/android/app/build/outputs/source')
mkdirSync(outputDir, { recursive: true })
const release = releaseVersion()
if (version.version !== release.version) throw new Error('Source and engine release versions must match')
const output = resolve(outputDir, `dcss-hns-${release.version}-source.tar.gz`)
const metadata = resolve(outputDir, 'metadata')
mkdirSync(resolve(metadata, 'mobile'), { recursive: true })
writeFileSync(resolve(metadata, 'mobile/release-info.json'), JSON.stringify({ version: release.version, build: version.build }) + '\n', 'utf8')
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const files = []
for (const file of listed) {
  if (file.startsWith('dist/')) continue
  const path = resolve(root, file)
  if (!existsSync(path)) continue
  if (!statSync(path).isDirectory()) files.push(file)
  else if (existsSync(resolve(path, '.git'))) {
    const sources = execFileSync('git', ['ls-files', '-z'], { cwd: path, encoding: 'utf8' })
      .split('\0').filter(Boolean)
    files.push(...sources.map(source => `${file}/${source}`))
  }
}
execFileSync('tar', ['-czf', output, '--null', '-T', '-', '-C', metadata, 'mobile/release-info.json'],
  { cwd: root, input: files.sort().join('\0') + '\0' })
console.log(`Complete source snapshot: ${output}`)
