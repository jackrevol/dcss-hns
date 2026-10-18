import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { packager } from '@electron/packager'
import { build } from 'esbuild'
import { releaseVersion } from './release-version.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(root, 'dist'), input = resolve(root, 'build/desktop-source')
const platform = process.env.HNS_DESKTOP_PLATFORM || process.platform
const arch = process.env.HNS_DESKTOP_ARCH || process.arch
const platformName = { darwin: 'mac', win32: 'windows', linux: 'linux' }[platform]
const release = releaseVersion()
if (!platformName || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported desktop platform or architecture')
await import('./build-sdl.mjs')
const native = resolve(root, 'build/sdl/native')
const nativeManifest = JSON.parse(readFileSync(resolve(native, 'desktop.json'), 'utf8'))
const version = existsSync(resolve(dist, 'offline/version.json'))
  ? JSON.parse(readFileSync(resolve(dist, 'offline/version.json'), 'utf8'))
  : { hns: true, build: release.build || createHash('sha256').update(readFileSync(resolve(native, nativeManifest.binary))).digest('hex').slice(0, 12),
    version: release.version }
if (!version.hns) throw new Error('Build the HNS client first')
if (version.version !== release.version) throw new Error('Rebuild the engine and UI with the same HNS_RELEASE_VERSION')
rmSync(input, { recursive: true, force: true }); mkdirSync(input, { recursive: true })
cpSync(resolve(root,'desktop'),input,{recursive:true,filter:path=>!path.endsWith('.ts')})
cpSync(dist,resolve(input,'web'),{recursive:true})
await build({ entryPoints: [resolve(root, 'desktop/native-session.ts')], outfile: resolve(input, 'native-session.cjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', define: { 'import.meta.env': '{}' } })
// PC 관리 창에는 게임용 모바일 WASM을 넣지 않습니다.
rmSync(resolve(input, 'web/offline'), { recursive: true, force: true })
mkdirSync(resolve(input, 'web/offline'), { recursive: true })
writeFileSync(resolve(input, 'web/offline/version.json'), JSON.stringify(version), 'utf8')
mkdirSync(resolve(input, 'web/desktop-assets'), { recursive: true })
const manifest = JSON.parse(readFileSync(resolve(native, 'desktop.json'), 'utf8'))
cpSync(resolve(native, manifest.fonts, 'DejaVuSansMono.ttf'), resolve(input, 'web/desktop-assets/DejaVuSansMono.ttf'))
cpSync(resolve(native, manifest.data, 'dat/tiles/logo.png'), resolve(input, 'web/desktop-assets/logo.png'))
cpSync(resolve(native, manifest.data, 'dat/tiles/stone_soup_icon-512x512.png'), resolve(input, 'web/desktop-assets/icon.png'))
const index = resolve(input, 'web/index.html')
writeFileSync(index, readFileSync(index, 'utf8').replaceAll('/icon-192.png', '/desktop-assets/icon.png'), 'utf8')
rmSync(resolve(input,'web/sw.js'),{force:true})
for (const name of ['LICENSE','ATTRIBUTION.md']) cpSync(resolve(root,name),resolve(input,'web',name+'.txt'))
cpSync(resolve(root,'../LICENSE'),resolve(input,'web/ENGINE-LICENSE.txt'))
writeFileSync(resolve(input,'package.json'),JSON.stringify({name:'dcss-hns-desktop',productName:'DCSS HNS',version:release.numericVersion,main:'main.cjs'}), 'utf8')
const outputs=await packager({dir:input,name:'DCSS HNS',out:resolve(root,'build/desktop'),
  platform,arch,
  appVersion: release.numericVersion,
  icon: resolve(root, '../crawl-ref/source/dat/tiles', platform === 'darwin' ? 'stone_soup_icon.icns' : platform === 'win32' ? 'stone_soup_icon.ico' : 'stone_soup_icon-512x512.png'),
  appBundleId:'io.github.jackrevol.dcsshns.desktop',asar:true,overwrite:true,extraResource:[native],
})
for(const output of outputs) {
  console.log('Desktop:',output)
  const archive = resolve(dirname(output), `DCSS-HNS-${release.version}-${platformName}-${arch}.${platform === 'linux' ? 'tar.gz' : 'zip'}`)
  if (platform === 'darwin') {
    execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',resolve(output,'DCSS HNS.app'),archive])
  } else if (platform === 'win32') {
    execFileSync('python3', ['-c',
      'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", root_dir=sys.argv[2], base_dir=sys.argv[3])',
      archive.slice(0, -4), dirname(output), basename(output)], { stdio: 'inherit' })
  } else {
    execFileSync('tar', ['-czf', archive, '-C', dirname(output), basename(output)], { stdio: 'inherit' })
  }
  console.log('Archive:',archive)
}
