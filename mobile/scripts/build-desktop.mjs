import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { packager } from '@electron/packager'
import { build } from 'esbuild'
import { releaseVersion } from './release-version.mjs'
import { readNativeBundle, sourceCommit } from './native-bundle.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(root, 'dist'), input = resolve(root, 'build/desktop-source')
const platform = process.env.HNS_DESKTOP_PLATFORM || process.platform
const arch = process.env.HNS_DESKTOP_ARCH || process.arch
const platformName = { darwin: 'mac', win32: 'windows', linux: 'linux' }[platform]
const release = releaseVersion()
if (!platformName || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported desktop platform or architecture')
execFileSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.desktop.config.ts'], { cwd: root, stdio: 'inherit' })
const prebuilt = process.argv.includes('--prebuilt-native')
if (!prebuilt) await import('./build-sdl.mjs')
const native = resolve(root, 'build/sdl/native')
const source = prebuilt ? sourceCommit(root) : undefined
if (prebuilt && !source) throw new Error('Cannot verify a prebuilt native engine without its source commit')
const nativeManifest = readNativeBundle(native, { platform, arch, version: release.version, ...(prebuilt ? { source } : {}) })
const version = existsSync(resolve(dist, 'offline/version.json'))
  ? JSON.parse(readFileSync(resolve(dist, 'offline/version.json'), 'utf8'))
  : { hns: true, build: release.build || createHash('sha256').update(readFileSync(resolve(native, nativeManifest.binary))).digest('hex').slice(0, 12),
    version: release.version }
if (!version.hns) throw new Error('Build the HNS client first')
if (version.version !== release.version) throw new Error('Rebuild the engine and UI with the same HNS_RELEASE_VERSION')
rmSync(input, { recursive: true, force: true }); mkdirSync(input, { recursive: true })
cpSync(resolve(root,'desktop'),input,{recursive:true,filter:path=>!path.endsWith('.ts')})
cpSync(resolve(root, 'build/desktop-web'),resolve(input,'web'),{recursive:true})
cpSync(resolve(root, 'public/_headers'), resolve(input, 'web/_headers'))
await build({ entryPoints: [resolve(root, 'desktop/native-session.ts')], outfile: resolve(input, 'native-session.cjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', define: { 'import.meta.env': '{}' } })
// PC 저장 서비스에는 게임용 모바일 WASM을 넣지 않습니다.
rmSync(resolve(input, 'web/offline'), { recursive: true, force: true })
mkdirSync(resolve(input, 'web/offline'), { recursive: true })
writeFileSync(resolve(input, 'web/offline/version.json'), JSON.stringify(version), 'utf8')
mkdirSync(resolve(input, 'web/desktop-assets'), { recursive: true })
const manifest = nativeManifest
cpSync(resolve(native, manifest.data, 'dat/tiles/stone_soup_icon-512x512.png'), resolve(input, 'web/desktop-assets/icon.png'))
rmSync(resolve(input,'web/sw.js'),{force:true})
for (const name of ['LICENSE','ATTRIBUTION.md']) cpSync(resolve(root,name),resolve(input,'web',name+'.txt'))
cpSync(resolve(root,'../LICENSE'),resolve(input,'web/ENGINE-LICENSE.txt'))
writeFileSync(resolve(input,'package.json'),JSON.stringify({name:'dcss-hns-desktop',productName:'DCSS HNS',version:release.numericVersion,main:'main.cjs'}), 'utf8')
// 실행 중인 앱을 교체하지 않고 별도 폴더에 새 빌드를 검증할 수 있습니다.
const outputs=await packager({dir:input,name:'DCSS HNS',out:resolve(process.env.HNS_DESKTOP_OUTPUT || resolve(root,'build/desktop')),
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
