import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { releaseVersion } from './release-version.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)),source=resolve(root,'../crawl-ref/source')
const release = releaseVersion()
execFileSync('make',['-j'+(process.env.JOBS||'8'),'WEBTILES=1','BUILD_LUA=1','FORCE_PKGCONFIG=1',`SRC_VERSION=${release.version}`],
  {cwd:source,stdio:'inherit',env:{...process.env,HNS_ENGINE_VERSION:release.version}})
const version=JSON.parse(readFileSync(resolve(root,'public/offline/version.json'),'utf8'))
if (version.version !== release.version) throw new Error('Rebuild WASM and native engines with the same HNS_RELEASE_VERSION')
const actual=execFileSync('sh',['wasm/build-id.sh'],{cwd:source,encoding:'utf8'}).trim()
if(actual!==version.build)throw new Error('WASM 엔진도 현재 소스로 다시 빌드한 뒤 실행하세요.')
const binary=resolve(source,process.platform==='win32'?'crawl.exe':'crawl')
mkdirSync(resolve(root,'native/dist'),{recursive:true})
writeFileSync(resolve(root,'native/dist/engine.json'),JSON.stringify({build:actual,version:version.version,
  binaryHash:createHash('sha256').update(readFileSync(binary)).digest('hex'),
}))
await import('./build-native-client.mjs')
