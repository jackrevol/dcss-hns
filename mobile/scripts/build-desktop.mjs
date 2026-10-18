import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { packager } from '@electron/packager'
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(root, 'dist'), input = resolve(root, 'build/desktop-source')
const version = JSON.parse(readFileSync(resolve(dist, 'offline/version.json'), 'utf8'))
if (!version.hns || !existsSync(resolve(dist,'offline/crawl.wasm.gz'))) throw new Error('Build the HNS engine and UI first')
rmSync(input, { recursive: true, force: true }); mkdirSync(input, { recursive: true })
cpSync(resolve(root,'desktop'),input,{recursive:true})
cpSync(dist,resolve(input,'web'),{recursive:true})
rmSync(resolve(input,'web/sw.js'),{force:true})
for (const name of ['LICENSE','ATTRIBUTION.md']) cpSync(resolve(root,name),resolve(input,'web',name+'.txt'))
cpSync(resolve(root,'../LICENSE'),resolve(input,'web/ENGINE-LICENSE.txt'))
writeFileSync(resolve(input,'package.json'),JSON.stringify({name:'dcss-hns-desktop',productName:'DCSS HNS',version:'0.1.0',main:'main.cjs'}))
const outputs=await packager({dir:input,name:'DCSS HNS',out:resolve(root,'build/desktop'),
  platform:process.env.HNS_DESKTOP_PLATFORM || process.platform,arch:process.env.HNS_DESKTOP_ARCH || process.arch,
  appBundleId:'io.github.jackrevol.dcsshns.desktop',asar:true,overwrite:true,
})
for(const output of outputs) {
  console.log('Desktop:',output)
  if(process.platform==='darwin' && output.endsWith('-darwin-'+(process.env.HNS_DESKTOP_ARCH||process.arch))) {
    const archive=resolve(output,'../DCSS-HNS-mac-'+(process.env.HNS_DESKTOP_ARCH||process.arch)+'.zip')
    execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',resolve(output,'DCSS HNS.app'),archive])
    console.log('Archive:',archive)
  }
}
