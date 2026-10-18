import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireNativeLock, createNativeIO, nativeFiles, recoverNativeDirectory, recoverNativeLock, replaceNativeFiles } from './storage'
import { decodeSnapshot, encodeSnapshot, snapshot } from '../src/cloud/snapshot'
let home:string
beforeEach(()=>{home=mkdtempSync(join(tmpdir(),'hns-native-test-'))})
afterEach(()=>rmSync(home,{recursive:true,force:true}))
const file=(name:string,text:string)=>({path:'/crawl/saves/'+name,mode:0o100664,mtimeMs:1,data:new TextEncoder().encode(text)})
describe('native saves shared with apps and browsers',()=>{
  it('round-trips the same binary pack and base state used by the browser',async()=>{
    const io=createNativeIO(home,'same-engine')
    const app=await snapshot([file('hero.cs','binary\0data')],'same-engine')
    await io.replace(await decodeSnapshot(encodeSnapshot(app)))
    expect((await io.local()).hash).toBe(app.hash)
    await io.setBase('account',app)
    expect((await io.base('account'))?.hash).toBe(app.hash)
  })
  it('applies deletions and keeps a recoverable previous directory',()=>{
    replaceNativeFiles(home,[file('old.cs','old')])
    replaceNativeFiles(home,[file('new.cs','new')])
    expect(nativeFiles(join(home,'crawl')).map(f=>f.path)).toEqual(['/crawl/saves/new.cs'])
    expect(readFileSync(join(home,'crawl.previous/saves/old.cs'),'utf8')).toBe('old')
  })
  it('recovers if the process stopped between the two directory renames',()=>{
    replaceNativeFiles(home,[file('hero.cs','before')])
    rmSync(join(home,'crawl.previous'),{recursive:true,force:true})
    renameSync(join(home,'crawl'),join(home,'crawl.previous'))
    recoverNativeDirectory(home)
    expect(readFileSync(join(home,'crawl/saves/hero.cs'),'utf8')).toBe('before')
  })
  it('rejects invalid replacements without changing the current run',()=>{
    replaceNativeFiles(home,[file('hero.cs','before')])
    expect(()=>replaceNativeFiles(home,[file('../evil','bad')])).toThrow()
    expect(readFileSync(join(home,'crawl/saves/hero.cs'),'utf8')).toBe('before')
  })
  it('never follows symlinks outside the managed save directory',()=>{
    const io=createNativeIO(home)
    mkdirSync(join(home,'outside'))
    writeFileSync(join(home,'outside/secret'),'private','utf8')
    symlinkSync(join(home,'outside'),join(home,'crawl/link'),process.platform==='win32'?'junction':'dir')
    expect(()=>nativeFiles(join(home,'crawl'))).toThrow(/심볼릭/)
  })
  it('excludes native regenerable caches and retains recovery packs',async()=>{
    const io=createNativeIO(home,'engine')
    await io.replace(await snapshot([file('hero.cs','before')],'engine'))
    mkdirSync(join(home,'crawl/saves/db'),{recursive:true});writeFileSync(join(home,'crawl/saves/db/cache'),'cache')
    const local=await io.local()
    expect(local.files).toHaveLength(1)
    await io.archive('before',local)
    const archive=readdirSync(join(home,'archives')).find(n=>n.endsWith('.pzsave'))!
    expect((await decodeSnapshot(readFileSync(join(home,'archives',archive)))).hash).toBe(local.hash)
  })
  it('blocks sync and crash recovery while the owning game process is alive',()=>{
    const lock=acquireNativeLock(home)
    expect(()=>acquireNativeLock(home)).toThrow(/실행 중/)
    expect(()=>recoverNativeLock(home)).toThrow(/프로세스/)
    lock.release()
    acquireNativeLock(home).release()
  })
})
