import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readNativeBundle } from './native-bundle.mjs'

const expected = { platform: 'linux', arch: 'x64', version: '0.35-a0-hns.3', source: 'a'.repeat(40) }
function bundle(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hns-native-bundle-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(join(directory, 'data/fonts'), { recursive: true })
  writeFileSync(join(directory, 'crawl'), 'binary')
  writeFileSync(join(directory, 'desktop.json'), JSON.stringify({
    client: 'sdl-tiles', ...expected, binary: 'crawl', data: 'data', fonts: 'data/fonts',
  }))
  return directory
}
test('같은 커밋·버전·플랫폼의 네이티브 결과만 이어서 패키징한다', t => {
  assert.equal(readNativeBundle(bundle(t), expected).source, expected.source)
})
test('다른 커밋·버전·아키텍처·클라이언트는 거부한다', t => {
  const directory = bundle(t)
  for (const [key, value] of Object.entries({ source: 'b'.repeat(40), version: '0.35-a0-hns.2', arch: 'arm64', platform: 'win32' }))
    assert.throws(() => readNativeBundle(directory, { ...expected, [key]: value }), /mismatch/)
  const path = join(directory, 'desktop.json'), manifest = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...manifest, client: 'webtiles' }))
  assert.throws(() => readNativeBundle(directory, expected), /client mismatch/)
})
test('누락된 바이너리와 번들 밖의 경로는 거부한다', t => {
  const directory = bundle(t), path = join(directory, 'desktop.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...manifest, binary: '../outside' }))
  assert.throws(() => readNativeBundle(directory, expected), /outside its directory/)
  writeFileSync(path, JSON.stringify(manifest))
  rmSync(join(directory, 'crawl'))
  assert.throws(() => readNativeBundle(directory, expected), /ENOENT/)
})
