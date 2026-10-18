// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { fakeStorage } from '../test/fake-storage'
const one={id:'player_one',username:'player_one',loginKey:createHash('sha256').update('DCSS-HNS-login-v1\0player_one\0password').digest('hex')}
const two={id:'player_two',username:'player_two',loginKey:createHash('sha256').update('DCSS-HNS-login-v1\0player_two\0password').digest('hex')}
const request=vi.fn()
beforeEach(()=>{
  vi.resetModules();request.mockReset()
  vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('localStorage',fakeStorage());vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('fetch',request)
  request.mockImplementation(async(url:string)=>new Response(JSON.stringify(url.endsWith('hns_login')||url.endsWith('hns_signup')?one.username:'')))
})
afterEach(()=>vi.unstubAllGlobals())
async function linked(){
  const m=await import('./supabase-provider'),provider=m.createSupabaseProvider()
  await m.signInCloud('player_one','password');m.linkCloudAccount();await provider.status()
  return {...m,provider}
}
it('sends only username/password to signup and stores the login key without retaining the password',async()=>{
  const m=await import('./supabase-provider')
  expect(await m.signUpCloud(' PLAYER_ONE ','password')).toBe(true)
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({p_id:'player_one',p_password:one.loginKey})
  expect(request.mock.calls[0][0]).toMatch(/\/rest\/v1\/rpc\/hns_signup$/)
  expect(m.cloudAccount()).toEqual({id:one.id,username:one.username})
})
it('requires explicit linking and reads local status without a network request',async()=>{
  const m=await import('./supabase-provider'),p=m.createSupabaseProvider()
  await m.signInCloud('player_one','password');expect(await p.status()).toBeNull()
  m.linkCloudAccount();expect((await p.status())?.label).toBe('player_one');expect(request).toHaveBeenCalledTimes(1)
})
it('rejects invalid usernames before any network request',async()=>{
  const m=await import('./supabase-provider')
  await expect(m.signInCloud('user@example.com','password')).rejects.toThrow(/아이디/)
  expect(request).not.toHaveBeenCalled()
})
it('does not silently adopt a different account',async()=>{
  const m=await linked();request.mockResolvedValue(new Response(JSON.stringify(two.username)))
  await m.signInCloud('player_two','password');expect(await m.provider.status()).toBeNull()
  await expect(m.provider.read()).rejects.toThrow(/연결/)
})
it('rejects a different account linked in another tab until status is refreshed',async()=>{
  const m=await linked();request.mockResolvedValue(new Response(JSON.stringify(two.username)))
  await m.signInCloud('player_two','password');m.linkCloudAccount()
  await expect(m.provider.read()).rejects.toThrow(/계정이 변경/)
})
it('pins every save request to the credentials captured at its start',async()=>{
  const m=await linked();await m.provider.write(new Uint8Array([0,128,255]),'expected')
  expect(JSON.parse(request.mock.calls.at(-1)![1].body)).toEqual({p_data:'AID/',p_expected:'expected',p_id:one.id,p_password:one.loginKey})
})
it('fails offline without contacting the server',async()=>{
  const m=await linked();request.mockClear();vi.stubGlobal('navigator',{onLine:false})
  await expect(m.provider.read()).rejects.toThrow(/오프라인/);expect(request).not.toHaveBeenCalled()
})
it('cancels a stuck request when the game starts',async()=>{
  const m=await linked()
  request.mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))))
  const pending=m.provider.read();m.provider.cancel();await expect(pending).rejects.toThrow(/Aborted/)
})
it('surfaces stale saves and server credential errors',async()=>{
  const m=await linked();request.mockResolvedValue(new Response(JSON.stringify({message:'HNS_SAVE_CHANGED'}),{status:400}))
  await expect(m.provider.write(new Uint8Array([1]),'old')).rejects.toThrow(/변경/)
  request.mockResolvedValue(new Response(JSON.stringify({error:'HNS_INVALID_CREDENTIALS'})))
  await expect(m.signInCloud('player_one','wrong-password')).rejects.toThrow(/비밀번호/)
})
it('keeps login across restarts without reauthenticating, until explicit logout',async()=>{
  const m=await linked();request.mockClear()
  expect([...Array(localStorage.length)].map((_,i)=>localStorage.getItem(localStorage.key(i)!)).join('')).not.toContain('password')
  vi.resetModules()
  const restarted=await import('./supabase-provider'),provider=restarted.createSupabaseProvider()
  expect(restarted.cloudAccount()).toEqual({id:one.id,username:one.username})
  expect((await provider.status())?.label).toBe(one.username)
  expect(request).not.toHaveBeenCalled()
  await provider.read();expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toMatch(/hns_read_save$/)
  await provider.disconnect();expect(restarted.cloudAccount()).toBeNull()
  vi.resetModules();expect((await import('./supabase-provider')).cloudAccount()).toBeNull()
})
