import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planRun } from './ci-plan.mjs'

test('master의 코드 변경은 테스트 없이 빌드 결과를 게시한다', () => {
  const plan = planRun({ eventName: 'push', ref: 'refs/heads/master', files: ['mobile/src/cloud/sync.ts'] })
  assert.equal(plan.build, true)
  assert.equal(plan.publish, true)
  assert.equal(plan.extended, false)
  assert.equal(plan.tests, false)
  assert.equal(plan.parallel, true)
  assert.equal(plan.standalone, true)
  assert.equal(plan.linux.include.length, 2)
  assert.equal(plan.msvc.include.length, 2)
  assert.equal(plan.desktop.include.length, 4)
  assert.deepEqual(plan.desktop.include.map(target => target.platform + '/' + target.arch),
    ['win32/x64', 'linux/x64', 'darwin/x64', 'darwin/arm64'])
})
test('문서만 바꾸면 APK·PC 빌드와 테스트·릴리즈를 생략한다', () => {
  const plan = planRun({ eventName: 'push', ref: 'refs/heads/master', files: ['README.md', 'crawl-ref/docs/changelog.txt'] })
  assert.equal(plan.build, false)
  assert.equal(plan.publish, false)
  assert.equal(plan.tests, false)
})
test('PR·다른 브랜치는 게시할 수 없고 워크플로 변경은 빌드한다', () => {
  for (const [eventName, ref] of [['pull_request', 'refs/pull/10/merge'], ['push', 'refs/heads/topic']]) {
    const plan = planRun({ eventName, ref, files: ['.github/workflows/ci.yml'] })
    assert.equal(plan.build, true)
    assert.equal(plan.publish, false)
    assert.equal(plan.tests, false)
  }
})
test('수동 실행은 문서 변경과 무관하게 빌드하며 게시와 확장을 따로 선택한다', () => {
  const plan = planRun({ eventName: 'workflow_dispatch', inputs: { publish: false, extended: true }, files: ['README.md'] })
  assert.equal(plan.build, true)
  assert.equal(plan.publish, false)
  assert.equal(plan.extended, true)
  assert.equal(plan.tests, true)
  assert.equal(plan.msvc.build_type.length * plan.msvc.build_arch.length, 8)
  assert.equal(plan.linux.include.filter(entry => entry.tag_upgrade).length, 3)
  assert.equal(plan.linux.include.filter(entry => entry.build_all).length, 2)
  assert.equal(planRun({ eventName: 'workflow_dispatch', inputs: { publish: true } }).publish, true)
})
test('게시된 태그도 테스트 없이 빌드하고 새 브랜치의 변경 목록이 없으면 빌드한다', () => {
  assert.equal(planRun({ eventName: 'release' }).publish, true)
  assert.equal(planRun({ eventName: 'release' }).tests, false)
  assert.equal(planRun({ eventName: 'push', ref: 'refs/heads/master' }).build, true)
})
test('기본 수동 실행도 빌드만 하며 테스트는 명시적으로 선택한다', () => {
  assert.equal(planRun({ eventName: 'workflow_dispatch' }).tests, false)
  const plan = planRun({ eventName: 'workflow_dispatch', inputs: { tests: true, publish: false } })
  assert.equal(plan.tests, true)
  assert.equal(plan.extended, false)
  assert.equal(plan.publish, false)
})

test('수동 태그 재빌드는 워크플로 커밋 대신 지정 태그의 정확한 소스를 선택한다', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'hns-ci-plan-'))
  const git = args => execFileSync('git', args, { cwd: temporary, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'CI test', GIT_COMMITTER_NAME: 'CI test',
      GIT_AUTHOR_EMAIL: 'ci@example.invalid', GIT_COMMITTER_EMAIL: 'ci@example.invalid' } }).trim()
  try {
    git(['init', '-q'])
    writeFileSync(join(temporary, 'source.cc'), 'old source')
    git(['add', '.']); git(['commit', '-qm', 'first'])
    const tagged = git(['rev-parse', 'HEAD'])
    git(['tag', 'v0.35-a0-hns.3'])
    writeFileSync(join(temporary, 'source.cc'), 'new source')
    git(['commit', '-qam', 'second'])
    const head = git(['rev-parse', 'HEAD'])
    const output = join(temporary, 'output'), summary = join(temporary, 'summary'), event = join(temporary, 'event.json')
    writeFileSync(event, JSON.stringify({ inputs: { tag: 'v0.35-a0-hns.3', publish: 'true', extended: 'false' } }))
    execFileSync(process.execPath, [fileURLToPath(new URL('./ci-plan.mjs', import.meta.url))], {
      cwd: temporary, env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_SHA: head, GITHUB_REF: 'refs/heads/master', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
    })
    const values = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => {
      const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]
    }))
    assert.equal(values.sha, tagged)
    assert.equal(values.version, '0.35-a0-hns.3')
    assert.equal(values.publish, 'true')
    assert.equal(values.extended, 'false')
    assert.equal(values.tests, 'false')
    assert.equal(values.parallel, 'false', '기존 태그의 스크립트에는 새 컴파일 분리를 강제하지 않는다')
    assert.equal(values.standalone, 'false', '기존 Electron 태그는 필요한 npm 의존성을 계속 설치한다')
  } finally { rmSync(temporary, { recursive: true, force: true }) }
})
