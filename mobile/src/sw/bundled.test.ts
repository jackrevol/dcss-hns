import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
const origin='https://game.example'
const template=readFileSync(new URL('./sw.js',import.meta.url),'utf8')
const classify=readFileSync(new URL('./classify.js',import.meta.url),'utf8').replace(/^export /gm,'')
function storage(){
  const maps=new Map<string,Map<string,Response>>()
  const key=(q:string|Request)=>new URL(typeof q==='string'?q:q.url,origin).href
  return {maps,
    async open(name:string){
      if(!maps.has(name))maps.set(name,new Map())
      const map=maps.get(name)!
      return {put:async(q:string,r:Response)=>{map.set(key(q),r)},match:async(q:string|Request)=>map.get(key(q))?.clone()}
    },
    keys:async()=>[...maps.keys()],delete:async(name:string)=>maps.delete(name),
    async match(q:string|Request,opts?:{cacheName?:string}){
      for(const [name,map]of maps)if(!opts?.cacheName||opts.cacheName===name){const r=map.get(key(q));if(r)return r.clone()}
      return undefined
    },
  }
}
function worker(body:string,cache=storage(),bad=false,decoded=false){
  const handlers=new Map<string,(event:any)=>void>(),claim=vi.fn(async()=>{})
  const manifest={version:createHash('sha256').update(body).digest('hex').slice(0,12),shellHtml:'shell',shellHeaders:{},assets:[],
    game:{hns:true,build:body,assets:[{path:'/offline/crawl.js',
      hash:decoded?'compressed-file-hash':createHash('sha256').update(body).digest('hex'),
      ...(decoded?{decodedHash:createHash('sha256').update(body).digest('hex')}:{})}]}}
  runInNewContext(template.replace('__PRECACHE_MANIFEST__',JSON.stringify(manifest)).replace('__CLASSIFY__',classify),{
    self:{location:{origin},registration:{},clients:{claim},addEventListener:(name:string,handler:any)=>handlers.set(name,handler)},
    caches:cache,fetch:async()=>new Response(bad?'corrupted':body),crypto:webcrypto,Response,URL,setTimeout,clearTimeout,
  })
  return {cache,claim,manifest,
    async run(name:string){let promise:Promise<unknown>|undefined;handlers.get(name)!({waitUntil:(p:Promise<unknown>)=>{promise=p}});await promise},
    async fetch(path:string){let promise:Promise<Response>|undefined;handlers.get('fetch')!({request:new Request(origin+path),respondWith:(p:Promise<Response>)=>{promise=p}});return promise},
  }
}
it('includes verified game data and a completion marker in the first client install',async()=>{
  const w=worker('game')
  await w.run('install');await w.run('activate')
  expect(await (await w.fetch('/offline/crawl.js'))?.text()).toBe('game')
  expect((await (await w.fetch('/offline/__bundled'))?.json()).build).toBe('game')
  expect(w.claim).toHaveBeenCalledTimes(1)
})
it('aborts an install with mixed/corrupted engine assets and removes its partial cache',async()=>{
  const w=worker('game',storage(),true)
  await expect(w.run('install')).rejects.toThrow(/changed during install/)
  expect(w.cache.maps.size).toBe(0)
})
it('accepts the pinned decoded bytes when a host applies gzip content encoding',async()=>{
  const w=worker('decoded game',storage(),false,true)
  await w.run('install')
  expect(await (await w.fetch('/offline/crawl.js'))?.text()).toBe('decoded game')
})
it('does not switch a running client to a waiting generation of game data',async()=>{
  const cache=storage(),old=worker('old',cache),next=worker('next',cache)
  await old.run('install');await old.run('activate');await next.run('install')
  expect(await (await old.fetch('/offline/crawl.js'))?.text()).toBe('old')
  await next.run('activate')
  expect(next.claim).not.toHaveBeenCalled()
  expect(await (await next.fetch('/offline/crawl.js'))?.text()).toBe('next')
})
