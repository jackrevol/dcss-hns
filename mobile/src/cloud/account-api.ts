import { CloudAccessError, CloudRaceError } from './provider'
import { SUPABASE_KEY, SUPABASE_URL } from './project'
import { normalizeUsername } from './identity'

export interface CloudAccount { id: string; username: string }
export interface CloudLogin extends CloudAccount { loginKey: string }
export function validLogin(value: unknown): value is CloudLogin {
  const v=value as Partial<CloudLogin> | null
  return !!v && typeof v.id==='string' && /^[a-z0-9_]{3,32}$/.test(v.id)
    && v.username===v.id && typeof v.loginKey==='string' && /^[a-f0-9]{64}$/.test(v.loginKey)
}
export async function deriveLoginKey(username:string,password:string):Promise<string> {
  const bytes=new TextEncoder().encode('DCSS-HNS-login-v1\0'+normalizeUsername(username)+'\0'+password)
  const digest=await crypto.subtle.digest('SHA-256',bytes)
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')
}
function failure(code: string): Error {
  if (code.includes('HNS_SAVE_CHANGED')) return new CloudRaceError()
  if (code.includes('HNS_USERNAME_TAKEN')) return new CloudAccessError('이미 사용 중인 아이디입니다.')
  if (code.includes('HNS_INVALID_CREDENTIALS')) return new CloudAccessError('아이디 또는 비밀번호를 확인하세요.')
  if (code.includes('HNS_SIGN_IN_REQUIRED')) return new CloudAccessError('클라우드에 다시 로그인하세요. 기기 세이브는 유지됩니다.')
  return new CloudAccessError('클라우드 요청을 처리하지 못했습니다. 기기 세이브는 유지됩니다.')
}
export async function accountRpc(name: string, args: Record<string,string>, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(10_000)
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: {apikey:SUPABASE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify(args), signal:signal ? AbortSignal.any([signal,timeout]) : timeout,
  })
  const value: unknown = response.status === 204 ? null : await response.json()
  const error = value as {error?:unknown;message?:unknown} | null
  if (!response.ok || typeof error?.error === 'string')
    throw failure(String(error?.error ?? error?.message ?? ''))
  return value
}
export async function authenticateAccount(command:'signup'|'login', input:string, password:string):Promise<CloudLogin> {
  const username=normalizeUsername(input)
  if (password.length<6)
    throw new CloudAccessError('비밀번호는 6자 이상이어야 합니다.')
  const loginKey=await deriveLoginKey(username,password)
  const result=await accountRpc(`hns_${command}`,{p_id:username,p_password:loginKey})
  if (result!==username) throw new CloudAccessError('계정을 확인하지 못했습니다.')
  return {id:username,username,loginKey}
}
export function credentialArgs(credentials:CloudLogin):Record<string,string> {
  return {p_id:credentials.id,p_password:credentials.loginKey}
}
