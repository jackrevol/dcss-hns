import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fakeCaches } from '../test/fake-caches'
import { bundledGameVersion } from './bundled-game'
import { fetchArtifact, newStats, probeReadiness } from './artifact-store'
let cache:ReturnType<typeof fakeCaches>
const game={build:'included-build',version:'0.35-a0-hns',hns:true}
beforeEach(()=>{
  cache=fakeCaches();vi.stubGlobal('caches',cache.storage)
  vi.stubGlobal('navigator',{});vi.stubGlobal('window',{});vi.stubGlobal('location',{hostname:'example.com'})
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...game,clientBundle:true}),{headers:{'Content-Type':'application/json'}})))
})
afterEach(()=>vi.unstubAllGlobals())
it('uses the game already included in a fresh desktop app without a download or cache installation',async()=>{
  vi.stubGlobal('window',{HnsDesktop:{bundled:true}})
  expect(await probeReadiness()).toMatchObject({state:'ready',tiles:true,bundled:true,build:game.build})
  expect(cache.caches.size).toBe(0)
})
it('waits for bundled metadata on a slow first desktop launch',async()=>{
  vi.stubGlobal('window',{HnsDesktop:{bundled:true}})
  vi.mocked(fetch).mockImplementation((_input,init)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resolve(new Response(JSON.stringify({...game,clientBundle:true}),{headers:{'Content-Type':'application/json'}})),1700)
    init?.signal?.addEventListener('abort',()=>{
      clearTimeout(timer)
      reject(init.signal?.reason)
    },{once:true})
  }))
  expect(await probeReadiness()).toMatchObject({state:'ready',tiles:true,bundled:true,build:game.build})
  expect(cache.caches.size).toBe(0)
},10_000)
it('recognizes bundled assets inside the Android engine worker too',async()=>{
  vi.stubGlobal('window',undefined);vi.stubGlobal('location',{hostname:'appassets.androidplatform.net'})
  expect(await bundledGameVersion()).toEqual(game)
})
it('does not claim a partially cached web client is ready',async()=>{
  const shell=await (cache.storage as CacheStorage).open('pz-shell-test')
  await shell.put('/offline/crawl.js',new Response('partial'))
  expect(await bundledGameVersion()).toBeNull()
  expect(await probeReadiness()).toMatchObject({state:'not-cached',bundled:true})
})
it('plays from a complete web-client bundle without extra engine downloads',async()=>{
  const shell=await (cache.storage as CacheStorage).open('pz-shell-test')
  await shell.put('/offline/__bundled',new Response(JSON.stringify(game)))
  await shell.put('/offline/crawl.js',new Response('included glue'))
  vi.mocked(fetch).mockRejectedValue(new Error('offline'))
  expect(await probeReadiness()).toMatchObject({state:'ready',bundled:true})
  const stats=newStats()
  expect(new TextDecoder().decode(await fetchArtifact(null,stats,'/offline/crawl.js'))).toBe('included glue')
  expect(stats.netFetches).toBe(0)
})
it('keeps a running web client pinned to its active worker rather than a waiting update',async()=>{
  for(const [name,build] of [['old','old-build'],['new','new-build']]){
    const shell=await (cache.storage as CacheStorage).open('pz-shell-'+name)
    await shell.put('/offline/__bundled',new Response(JSON.stringify({...game,build})))
  }
  vi.stubGlobal('navigator',{serviceWorker:{controller:{}}})
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({...game,build:'old-build'})))
  expect((await bundledGameVersion())?.build).toBe('old-build')
})
