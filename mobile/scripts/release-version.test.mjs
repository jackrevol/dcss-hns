import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { releaseVersion, versionConfig } from './release-version.mjs'

function project(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hns-version-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const mobile = join(directory, 'mobile'); mkdirSync(mobile)
  return { directory, mobile }
}

test('로컬 빌드도 현재 커밋의 태그를 재사용하고 미발행 커밋은 다음 순번을 쓴다', t => {
  const { directory, mobile } = project(t)
  const git = args => execFileSync('git', args, { cwd: directory, stdio: 'pipe', encoding: 'utf8' }).trim()
  git(['init', '-q'])
  const commit = () => git(['-c', 'user.name=Version Test', '-c', 'user.email=version@example.invalid', 'commit', '--allow-empty', '-qm', 'version fixture'])
  commit(); git(['tag', `v${versionConfig.upstream}-hns.5`])
  const tagged = git(['rev-parse', 'HEAD'])
  assert.equal(releaseVersion(mobile, {}).revision, 5)
  commit()
  assert.equal(releaseVersion(mobile, {}).revision, 6)
  git(['tag', `v${versionConfig.upstream}-hns.9`])
  git(['checkout', '--detach', tagged])
  assert.equal(releaseVersion(mobile, {}).revision, 5, 'Old tagged commits keep their own version')
})

test('CI 지정 버전과 대응 소스에 기록한 버전은 Git 기본값보다 우선한다', t => {
  const { mobile } = project(t)
  writeFileSync(join(mobile, 'release-info.json'), JSON.stringify({ version: `${versionConfig.upstream}-hns.4`, build: 'recorded' }))
  assert.equal(releaseVersion(mobile, {}).revision, 4)
  assert.equal(releaseVersion(mobile, {}).build, 'recorded')
  const override = releaseVersion(mobile, { HNS_RELEASE_VERSION: `${versionConfig.upstream}-hns.8` })
  assert.equal(override.revision, 8)
  assert.equal(override.build, undefined)
})

test('Git과 릴리즈 기록이 없는 소스만 version.json 기본값을 사용한다', t => {
  assert.equal(releaseVersion(project(t).mobile, {}).revision, versionConfig.revision)
})
