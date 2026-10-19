import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { releaseVersion } from './release-version.mjs'
import { readNativeBundle, sourceCommit } from './native-bundle.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const platform = process.env.HNS_DESKTOP_PLATFORM || process.platform
const arch = process.env.HNS_DESKTOP_ARCH || process.arch
const platformName = { darwin: 'mac', win32: 'windows', linux: 'linux' }[platform]
const release = releaseVersion()
if (!platformName || !(platform === 'darwin' ? ['x64', 'arm64'] : ['x64']).includes(arch)) throw new Error('Unsupported desktop target')
const prebuilt = process.argv.includes('--prebuilt-native')
if (!prebuilt) await import('./build-sdl.mjs')
const native = resolve(root, 'build/sdl/native')
const source = prebuilt ? sourceCommit(root) : undefined
if (prebuilt && !source) throw new Error('Cannot verify the source commit of a prebuilt engine')
const manifest = readNativeBundle(native, { platform, arch, standalone: true, version: release.version, ...(prebuilt ? { source } : {}) })
const base = resolve(process.env.HNS_DESKTOP_OUTPUT || resolve(root, 'build/desktop'))
const output = resolve(base, `DCSS HNS-${platform}-${arch}`)
rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true })
let app, data
if (platform === 'darwin') {
  app = resolve(output, 'DCSS HNS.app')
  cpSync(resolve(native, 'DCSS HNS.app'), app, { recursive: true })
  data = resolve(app, 'Contents/Resources')
} else {
  cpSync(native, output, { recursive: true })
  data = resolve(output, manifest.data)
}
const versionPath = resolve(root, 'dist/offline/version.json')
const version = existsSync(versionPath) ? JSON.parse(readFileSync(versionPath, 'utf8')) : {
  hns: true, version: release.version,
  build: createHash('sha256').update(readFileSync(resolve(native, manifest.binary))).digest('hex').slice(0, 12),
}
if (!version.hns || version.version !== release.version) throw new Error('Engine and package versions differ')
const project = readFileSync(resolve(root, 'src/cloud/project.ts'), 'utf8')
const cloud = {
  url: process.env.VITE_SUPABASE_URL || /SUPABASE_URL[^\n]+\|\| '([^']+)'/.exec(project)?.[1],
  key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || /SUPABASE_KEY[^\n]+\|\| '([^']+)'/.exec(project)?.[1],
}
if (!cloud.url?.startsWith('https://') || !cloud.key) throw new Error('Invalid public cloud project configuration')
writeFileSync(resolve(data, 'hns-native.json'), JSON.stringify({ ...version, source: manifest.source, standalone: true, cloud }) + '\n')
cpSync(resolve(root, '../crawl-ref/source/contrib/hns-native'), resolve(data, 'licenses/hns-native'), { recursive: true,
  filter: path => !path.endsWith('.h') && !path.endsWith('.hpp') })
if (platform === 'darwin') {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
const archive = resolve(base, `DCSS-HNS-${release.version}-${platformName}-${arch}.${platform === 'linux' ? 'tar.gz' : 'zip'}`)
if (platform === 'darwin') execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive])
else if (platform === 'win32') execFileSync('python3', ['-c',
  'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", root_dir=sys.argv[2], base_dir=sys.argv[3])',
  archive.slice(0, -4), dirname(output), basename(output)], { stdio: 'inherit' })
else execFileSync('tar', ['-czf', archive, '-C', dirname(output), basename(output)], { stdio: 'inherit' })
console.log('Standalone SDL app:', output)
console.log('Archive:', archive)
