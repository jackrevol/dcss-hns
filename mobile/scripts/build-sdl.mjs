import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVersion } from './release-version.mjs'
import { readNativeBundle, sourceCommit } from './native-bundle.mjs'
import { readDllImports } from './windows-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = resolve(root, '../crawl-ref/source')
const platform = process.env.HNS_DESKTOP_PLATFORM || process.platform
const arch = process.env.HNS_DESKTOP_ARCH || process.arch
const release = releaseVersion()
const platformName = { darwin: 'mac', win32: 'windows', linux: 'linux' }[platform]
if (!platformName || !(platform === 'darwin' ? ['x64', 'arm64'] : ['x64']).includes(arch)) throw new Error('Unsupported desktop platform or architecture')
if (platform !== process.platform || arch !== process.arch) throw new Error('Build desktop clients on the matching platform and architecture')
const output = resolve(root, 'build/sdl/native')
const run = (command, args, cwd = source) => execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, HNS_ENGINE_VERSION: release.version } })
const makeArgs = ['-j' + (process.env.JOBS || '8'), 'TILES=1', 'BUILD_LUA=1', 'HNS_NATIVE_DESKTOP=1', 'SAVEDIR=', `SRC_VERSION=${release.version}`]
if (platform === 'darwin') makeArgs.push('MACOSX_MIN_VERSION=11.0')
const reset = path => {
  const target = resolve(path)
  if (!target.startsWith(resolve(root, '..') + sep)) throw new Error('Build directory is outside the workspace')
  rmSync(target, { recursive: true, force: true })
}
// 실제 플레이는 원본 SDL 클라이언트가 담당합니다.
reset(output)
mkdirSync(output, { recursive: true })
let binary, data, fonts
if (platform === 'win32') {
  const stage = 'build/hns-desktop-windows'
  reset(resolve(source, stage))
  run('make', [...makeArgs, `DESTDIR=${stage}`, 'install'])
  cpSync(resolve(source, stage), output, { recursive: true })
  binary = resolve(output, 'DCSS HNS.exe')
  renameSync(resolve(output, 'crawl.exe'), binary)
  // libcurl and its TLS dependencies are private app libraries, never a launcher.
  const bin = execFileSync('cygpath', ['-w', '/mingw64/bin'], { encoding: 'utf8' }).trim()
  const copied = new Set()
  const libraries = async path => {
    for (const name of await readDllImports(path)) {
      const key = name.toLowerCase()
      if (copied.has(key)) continue
      copied.add(key)
      const library = resolve(bin, name)
      if (existsSync(library)) { cpSync(library, resolve(output, name)); await libraries(resolve(output, name)) }
      else if (!/^(?:api-ms-|ext-ms-)/i.test(name) && !existsSync(resolve(process.env.SystemRoot || 'C:/Windows', 'System32', name)))
        throw new Error('Missing Windows runtime library: ' + name)
    }
  }
  await libraries(binary)
  const prefix = dirname(bin), certificates = resolve(prefix, 'etc/ssl/certs/ca-bundle.crt')
  if (!existsSync(certificates)) throw new Error('Missing trusted CA bundle for native HTTPS')
  cpSync(certificates, resolve(output, 'hns-ca-bundle.crt'), { dereference: true })
  cpSync(resolve(prefix, 'share/licenses'), resolve(output, 'licenses/runtime'), { recursive: true })
  data = output
} else if (platform === 'darwin') {
  run('make', [...makeArgs, 'mac-app-tiles'])
  const app = resolve(output, 'DCSS HNS.app')
  cpSync(resolve(source, 'build/app-bundle-stage/Dungeon Crawl Stone Soup - Tiles.app'), app, { recursive: true })
  binary = resolve(app, 'Contents/MacOS/DCSS HNS')
  renameSync(resolve(app, 'Contents/MacOS/Dungeon Crawl Stone Soup - Tiles'), binary)
  const plist = resolve(app, 'Contents/Info.plist')
  writeFileSync(plist, readFileSync(plist, 'utf8')
    .replaceAll('Dungeon Crawl Stone Soup - Tiles', 'DCSS HNS')
    .replaceAll('Dungeon Crawl Stone Soup', 'DCSS HNS')
    .replace('<string>10.7.0</string>', '<string>11.0</string>')
    .replace('net.sourceforge.crawl-ref', 'io.github.jackrevol.dcsshns.desktop'), 'utf8')
  data = resolve(app, 'Contents/Resources')
  fonts = resolve(app, 'Contents/MacOS/contrib/fonts')
} else {
  const deploy = process.env.LINUXDEPLOY
  if (!deploy || !existsSync(deploy)) throw new Error('Set LINUXDEPLOY to linuxdeploy AppImage before building Linux desktop')
  reset(resolve(source, 'appimage'))
  run('make', [...makeArgs, `LINUXDEPLOY=${resolve(deploy)}`, 'appimage'])
  // 추출한 AppDir로 배포하여 FUSE 없이 번들된 SDL 라이브러리를 사용합니다.
  run(resolve(source, 'stone_soup-latest-linux-tiles.x86_64.AppImage'), ['--appimage-extract'], output)
  renameSync(resolve(output, 'squashfs-root'), resolve(output, 'AppDir'))
  writeFileSync(resolve(output, 'DCSS HNS'), '#!/bin/sh\nexec "$(dirname "$0")/AppDir/AppRun" "$@"\n', { encoding: 'utf8', mode: 0o755 })
  binary = resolve(output, 'AppDir/usr/bin/crawl')
  data = resolve(output, 'AppDir/usr')
}
cpSync(resolve(root, '../LICENSE'), resolve(output, 'LICENSE.txt'))
cpSync(resolve(root, '../crawl-ref/CREDITS.txt'), resolve(output, 'CREDITS.txt'))
writeFileSync(resolve(output, 'desktop.json'), JSON.stringify({
  client: 'sdl-tiles', standalone: true, platform, arch,
  version: release.version,
  source: sourceCommit(root),
  binary: binary.slice(output.length + 1), data: data.slice(output.length + 1) || '.',
  fonts: (fonts || resolve(data, 'dat/tiles')).slice(output.length + 1),
}, null, 2) + '\n', 'utf8')
if (platform === 'darwin') run('codesign', ['--force', '--deep', '--sign', '-', resolve(output, 'DCSS HNS.app')])
// 필수 파일은 항상 확인하고, 게임 실행 검사는 요청할 때만 수행합니다.
readNativeBundle(output, { platform, arch, version: release.version })
if (process.argv.includes('--verify')) run(process.execPath, [resolve(root, 'scripts/test-sdl.mjs'), output], root)
console.log('Native engine:', output)
