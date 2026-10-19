import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const source = resolve(root, '../crawl-ref/source')
const directory = mkdtempSync(resolve(tmpdir(), 'hns-native-backend-'))
try {
  const executable = resolve(directory, process.platform === 'win32' ? 'native-tests.exe' : 'native-tests')
  const pkg = flag => execFileSync('pkg-config', [flag, 'libcurl'], {encoding:'utf8'}).trim().split(/\s+/).filter(Boolean)
  execFileSync(process.env.CXX || (process.platform === 'win32' ? 'g++' : 'c++'), ['-std=c++17', '-O1', '-I', source,
    ...pkg('--cflags'), ...['test/hns-native-tests.cc', 'hns-native-pack.cc', 'hns-native-migrate.cc', 'hns-native-cloud.cc'].map(name => resolve(source,name)),
    ...pkg('--libs'), '-o', executable], {stdio:'inherit'})
  execFileSync(executable, [], {stdio:'inherit'})
  const legacy = resolve(directory,'legacy'); mkdirSync(legacy)
  const fixture = JSON.parse(readFileSync(resolve(source,'test/data/hns-legacy-storage.json'),'utf8'))
  for(const [name,data] of Object.entries(fixture.files)) writeFileSync(resolve(legacy,name),Buffer.from(data,'base64'))
  execFileSync(executable, ['--legacy',legacy], {stdio:'inherit'})
} finally { rmSync(directory,{recursive:true,force:true}) }
