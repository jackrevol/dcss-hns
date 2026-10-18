import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { CloudSynchronizer } from '../src/cloud/sync'
import { type CloudProvider } from '../src/cloud/provider'
import { MAX_CLOUD_BYTES, decodeSnapshot, encodeSnapshot } from '../src/cloud/snapshot'
import { SUPABASE_URL } from '../src/cloud/project'
import { normalizeUsername } from '../src/cloud/identity'
import { accountRpc, authenticateAccount, credentialArgs, validLogin, type CloudLogin } from '../src/cloud/account-api'
import { acquireNativeLock, atomicWrite, createNativeIO, nativeFiles, recoverNativeLock } from './storage'

const root = fileURLToPath(new URL('../..',import.meta.url))
const home = resolve(process.env.HNS_NATIVE_HOME || join(homedir(),'.dcss-hns-native'))
const dataRoot = join(home,'crawl')
const binary = resolve(process.env.HNS_NATIVE_BINARY || join(root,'../crawl-ref/source',process.platform==='win32'?'crawl.exe':'crawl'))
const userFile = join(home,'account.json'), authFile = join(home,'session.json')
type Account = CloudLogin & {linked:boolean}
const account = (): Account | null => {
  if (!existsSync(userFile)) return null
  const value=JSON.parse(readFileSync(userFile,'utf8'))
  return validLogin(value) ? value as Account : null
}
async function password(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('비밀번호는 터미널에서 직접 입력하세요. 명령 인자로 전달하지 않습니다.')
  process.stdout.write('비밀번호: ')
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8')
  return new Promise((resolve,reject) => {
    let value=''
    const cleanup = () => {process.stdin.off('data',read);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n')}
    const read = (input:string) => {
      for(const c of input) {
        if(c==='\r'||c==='\n'){cleanup();resolve(value);return}
        if(c==='\u0003'){cleanup();reject(new Error('취소했습니다.'));return}
        if(c==='\u007f'||c==='\b')value=value.slice(0,-1)
        else if(c>=' ')value+=c
      }
    }
    process.stdin.on('data',read)
  })
}
async function credentials() {
  const input=createInterface({input:process.stdin,output:process.stdout})
  const inputName=await input.question('아이디: ');input.close()
  const username=normalizeUsername(inputName)
  return {username,password:await password()}
}
function engineBuild(): string | undefined {
  const stamp=join(root,'native/dist/engine.json')
  if(!existsSync(stamp)||!existsSync(binary)) return undefined
  const value=JSON.parse(readFileSync(stamp,'utf8'))
  if(createHash('sha256').update(readFileSync(binary)).digest('hex')!==value.binaryHash)
    throw new Error('네이티브 엔진이 변경됐습니다. npm run build:native로 다시 빌드하세요.')
  return value.build
}
async function rpc(name:string,args?:Record<string,string>):Promise<unknown> {
  const expected=account()
  if(!expected?.linked)throw new Error('native login 후 native link로 기기 세이브를 연결하세요.')
  return accountRpc(name,{...args,...credentialArgs(expected)})
}

const provider:CloudProvider={
  supported:()=>true,
  async status(){const value=account();return value?.linked?{key:SUPABASE_URL+':'+value.id,label:value.username,allowEmpty:true}:null},
  async read(){const raw=await rpc('hns_read_save');if(typeof raw!=='string'||raw.length>45_800_000)throw new Error('잘못된 클라우드 응답');return new Uint8Array(Buffer.from(raw,'base64'))},
  async write(bytes,expected){if(bytes.length>MAX_CLOUD_BYTES)throw new Error('세이브가 32 MB를 넘습니다.');await rpc('hns_write_save',{p_data:Buffer.from(bytes).toString('base64'),p_expected:expected})},
  async disconnect(){atomicWrite(userFile,'null');rmSync(authFile,{force:true})},
}
async function sync(choice?:'local'|'remote') {
  const cloud=new CloudSynchronizer(provider,createNativeIO(home,engineBuild()))
  await cloud.initialize()
  if(!cloud.link){console.log('클라우드 미연결 · 기기에 저장됩니다.');return}
  cloud.subscribe(state=>console.log(state.message))
  if(choice){
    // Observe and archive both current versions before resolving a conflict.
    try{await cloud.sync()}catch{if(cloud.state.phase!=='conflict')throw new Error(cloud.state.message)}
    if(cloud.state.phase==='conflict')await cloud.sync({choice})
  }else await cloud.sync()
}
async function main(){
  const [command='help',...args]=process.argv.slice(2)
  if(command==='help'){
    console.log('DCSS HNS native client\n  signup | login | link | logout | status | sync [--local|--remote]\n  play [engine options...] | export <file.pzsave> | import <file.pzsave>\n  import-native <save-directory> | archives | restore <hash> | unlock\n로그인 없이 play 가능. 비밀번호는 터미널에서만 입력합니다.');return
  }
  mkdirSync(home,{recursive:true,mode:0o700})
  if(command==='unlock'){recoverNativeLock(home);console.log('남은 잠금 기록을 해제했습니다.');return}
  const lock=acquireNativeLock(home)
  try{
    const io=createNativeIO(home,engineBuild())
    if(command==='signup'||command==='login'){
      const value=await credentials()
      const verified=await authenticateAccount(command,value.username,value.password)
      const previous=account()
      atomicWrite(userFile,JSON.stringify({...verified,linked:previous?.id===verified.id&&previous.linked}))
      rmSync(authFile,{force:true})
      console.log('로그인 완료. 현재 기기의 세이브를 연결하려면 native link를 실행하세요.')
    }else if(command==='link'){
      const value=account();if(!value)throw new Error('먼저 로그인하세요.')
      console.log('현재 기기의 세이브를 '+value.username+' 계정과 연결합니다.')
      atomicWrite(userFile,JSON.stringify({...value,linked:true}));await sync()
    }else if(command==='logout'){await provider.disconnect();console.log('로그아웃했습니다. 기기 세이브는 유지됩니다.')}
    else if(command==='status')console.log({account:account()?.username||null,linked:account()?.linked||false,home,engineBuild:engineBuild()||'unknown'})
    else if(command==='sync')await sync(args.includes('--local')?'local':args.includes('--remote')?'remote':undefined)
    else if(command==='export'){
      if(!args[0])throw new Error('내보낼 파일명을 지정하세요.')
      writeFileSync(resolve(args[0]),encodeSnapshot(await io.local()),{mode:0o600,flag:'wx'});console.log('백업을 내보냈습니다.')
    }else if(command==='import-native'){
      if(!args[0])throw new Error('기존 엔진의 saves 폴더를 지정하세요.')
      const incoming=nativeFiles(resolve(args[0])).filter(f=>!/^\/crawl\/(db|des)(\/|$)/.test(f.path))
        .map(f=>({...f,path:'/crawl/saves/'+f.path.slice('/crawl/'.length)}))
      const local=await io.local()
      const combined=new Map(local.files.map(f=>[f.path,f]))
      for(const file of incoming)combined.set(file.path,file)
      await io.archive('기존 네이티브 세이브 가져오기 전',local)
      await io.replace({...local,files:[...combined.values()]})
      console.log('기존 폴더를 유지하고 '+incoming.length+'개 파일을 가져왔습니다.')
    }else if(command==='import'||command==='restore'){
      if(!args[0]||(command==='restore'&&!/^[a-f0-9]{64}$/.test(args[0])))throw new Error('백업 파일 또는 복구 사본 해시를 지정하세요.')
      const path=command==='import'?resolve(args[0]):join(home,'archives',args[0]+'.pzsave')
      const value=await decodeSnapshot(readFileSync(path))
      if(value.build&&engineBuild()&&value.build!==engineBuild())throw new Error('엔진 빌드가 다릅니다. 동일한 버전에서 복원하세요.')
      await io.archive('복원 전 이 기기',await io.local());await io.replace(value);console.log('기기 세이브를 복원했습니다.')
    }else if(command==='archives')console.log(readdirSync(join(home,'archives')).filter(n=>n.endsWith('.pzsave')).join('\n')||'복구 사본 없음')
    else if(command==='play'){
      if(!existsSync(binary))throw new Error('네이티브 엔진이 없습니다. npm run build:native를 실행하세요.')
      mkdirSync(join(dataRoot,'saves'),{recursive:true});mkdirSync(join(dataRoot,'morgue'),{recursive:true})
      const rc=join(dataRoot,'init.txt');if(!existsSync(rc))writeFileSync(rc,'',{mode:0o600})
      // Local startup makes no network request. Override only filesystem paths;
      // the synchronized init.txt remains platform-independent.
      const child=spawn(binary,['-dir',join(root,'../crawl-ref/source'),'-rc',rc,'-morgue',join(dataRoot,'morgue'),'-macro',join(dataRoot,'saves'),...args,'-extra-opt-last','save_dir='+join(dataRoot,'saves'),'-extra-opt-last','restart_after_save=false'],{stdio:'inherit'})
      if(child.pid)lock.child(child.pid)
      const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1))})
      try{await sync()}catch(e){console.warn('동기화 대기:',e instanceof Error?e.message:String(e))}
      process.exitCode=code
    }else throw new Error('알 수 없는 명령입니다. native help를 실행하세요.')
  }finally{lock.release()}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1})
