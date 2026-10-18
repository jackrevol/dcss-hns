import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVersion } from './release-version.mjs'

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
const makeArgs = ['-j' + (process.env.JOBS || '8'), 'TILES=1', 'BUILD_LUA=1', `SRC_VERSION=${release.version}`]
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
  client: 'sdl-tiles', platform, arch,
  version: release.version,
  binary: binary.slice(output.length + 1), data: data.slice(output.length + 1) || '.',
  fonts: (fonts || resolve(data, 'dat/tiles')).slice(output.length + 1),
}, null, 2) + '\n', 'utf8')
if (platform === 'darwin') run('codesign', ['--force', '--deep', '--sign', '-', resolve(output, 'DCSS HNS.app')])
// 압축 전에 실제 배포 바이너리와 데이터로 검사합니다.
run(process.execPath, [resolve(root, 'scripts/test-sdl.mjs'), output], root)
console.log('Native engine:', output)
