import { CloudAccessError, type CloudLink, type CloudProvider } from './provider'
import { MAX_CLOUD_BYTES } from './snapshot'
import { SUPABASE_KEY, SUPABASE_URL } from './project'
import { accountRpc, authenticateAccount, credentialArgs, type CloudAccount, validLogin, type CloudLogin } from './account-api'
export type { CloudAccount } from './account-api'

const OWNER_KEY = `hns-cloud-owner:${SUPABASE_URL}`
const LOGIN_KEY = `hns-cloud-login:${SUPABASE_URL}`
function storedLogin(): CloudLogin | null {
  try { clearLegacyLogin();const value:unknown=JSON.parse(localStorage.getItem(LOGIN_KEY)??'null'); return validLogin(value)?value:null }
  catch { return null }
}
export function cloudAccount(): CloudAccount | null {
  const value=storedLogin();return value?{id:value.id,username:value.username}:null
}
function clearLegacyLogin(): void {
  localStorage.removeItem(`hns-cloud-account:${SUPABASE_URL}`)
  localStorage.removeItem(`hns-cloud-username-session:${SUPABASE_URL}`)
  localStorage.removeItem('sb-'+new URL(SUPABASE_URL).hostname.split('.')[0]+'-auth-token')
}
export async function signInCloud(input: string, password: string): Promise<void> {
  const account=await authenticateAccount('login',input,password)
  clearLegacyLogin();localStorage.setItem(LOGIN_KEY,JSON.stringify(account))
}
export async function signUpCloud(input: string, password: string): Promise<boolean> {
  const account=await authenticateAccount('signup',input,password)
  clearLegacyLogin();localStorage.setItem(LOGIN_KEY,JSON.stringify(account))
  return true
}
export function linkCloudAccount(): void {
  const account = cloudAccount()
  if (!account) throw new CloudAccessError('먼저 로그인하세요.')
  localStorage.setItem(OWNER_KEY, account.id)
}
function decode64(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_CLOUD_BYTES / 3) * 4 + 1_000_000)
    throw new Error('클라우드 세이브가 32 MB를 넘습니다.')
  const binary = atob(value.replace(/\s/g, ''))
  if (binary.length > MAX_CLOUD_BYTES) throw new Error('클라우드 세이브가 32 MB를 넘습니다.')
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}
function encode64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export interface AccountProvider extends CloudProvider { cancel(): void }
export function createSupabaseProvider(): AccountProvider {
  let controller: AbortController | undefined
  let expectedKey: string | undefined
  const accountLink = (): CloudLink | null => {
    const account = cloudAccount()
    if (!account || localStorage.getItem(OWNER_KEY) !== account.id) return null
    return { key: `${SUPABASE_URL}:${account.id}`, label: account.username, allowEmpty: true }
  }
  async function rpc(name: string, args: Record<string,string> = {}): Promise<unknown> {
    const linked = accountLink(), auth = storedLogin()
    if (!linked || !auth) throw new CloudAccessError('로그인 후 기기 세이브를 연결하세요.')
    if (linked.key !== expectedKey) throw new CloudAccessError('다른 창에서 계정이 변경됐습니다. 클라우드 설정을 다시 여세요.')
    if (!navigator.onLine) throw new CloudAccessError('오프라인 · 진행은 이 기기에 저장됩니다.')
    const abort = new AbortController()
    controller = abort
    try {
      // Capture the credentials once; a later login cannot change this call's owner.
      const result = await accountRpc(name,{...args,...credentialArgs(auth)},abort.signal)
      if (accountLink()?.key !== linked.key) throw new CloudAccessError('계정이 변경됐습니다. 기기 세이브를 유지합니다.')
      return result
    } finally { if (controller === abort) controller = undefined }
  }
  return {
    cancel() { controller?.abort() },
    supported: () => !!SUPABASE_URL && !!SUPABASE_KEY,
    async status() { // Local only; no authentication or network during game startup.
      const link = accountLink(); expectedKey = link?.key; return link
    },
    async read() {
      const result = await rpc('hns_read_save')
      if (typeof result !== 'string') throw new Error('클라우드 응답을 읽지 못했습니다.')
      return decode64(result)
    },
    async write(bytes, expectedRawHash) {
      if (bytes.byteLength > MAX_CLOUD_BYTES) throw new Error('세이브가 32 MB를 넘습니다.')
      await rpc('hns_write_save', { p_data: encode64(bytes), p_expected: expectedRawHash })
    },
    async disconnect() {
      localStorage.removeItem(LOGIN_KEY);clearLegacyLogin()
      // Keep OWNER_KEY so logging into another account never silently adopts
      // this device's existing characters. Linking is always an explicit tap.
    },
  }
}
