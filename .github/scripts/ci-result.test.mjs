import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarize } from './ci-result.mjs'

const stages = ['plan', 'checks', 'client', 'android', 'native', 'desktop', 'engine', 'msvc', 'catch2',
  'headers', 'universal', 'mingw', 'legacy_android', 'webserver', 'monster', 'docs']
const ordinary = stages.slice(0, 9)
function results(build = true, extended = false) {
  return Object.fromEntries(stages.map(name => [name, {
    result: extended || (build ? ordinary.includes(name) : ['plan', 'checks'].includes(name)) ? 'success' : 'skipped',
    outputs: name === 'plan' ? { build: String(build), extended: String(extended), parallel: 'true' } : {},
  }]))
}
test('일반 빌드 성공 시 확장 검사의 의도한 생략을 허용한다', () => {
  const result = summarize(results())
  assert.equal(result.ok, true)
  assert.match(result.markdown, /\n\| desktop \| success \|\n/)
})
test('문서 변경은 패키지 검사 생략을 허용하지만 코드 검사는 필수다', () => {
  const jobs = results(false)
  assert.equal(summarize(jobs).ok, true)
  jobs.checks.result = 'skipped'
  assert.equal(summarize(jobs).ok, false)
})
test('앱 빌드가 생략되거나 실패하거나 취소되면 게시를 막는다', () => {
  for (const result of ['skipped', 'failure', 'cancelled']) {
    for (const name of ['native', 'desktop']) {
      const jobs = results()
      jobs[name].result = result
      assert.equal(summarize(jobs).ok, false)
    }
  }
})
test('확장 검사를 요청하면 모든 확장 작업도 통과해야 한다', () => {
  const jobs = results(true, true)
  assert.equal(summarize(jobs).ok, true)
  jobs.headers.result = 'skipped'
  assert.equal(summarize(jobs).ok, false)
})
test('선택 작업의 실제 실패와 실행 계획 실패도 성공으로 숨기지 않는다', () => {
  const jobs = results()
  jobs.docs.result = 'failure'
  assert.equal(summarize(jobs).ok, false)
  jobs.docs.result = 'skipped'
  jobs.plan.result = 'failure'
  assert.equal(summarize(jobs).ok, false)
})
test('컴파일 분리를 지원하지 않는 기존 태그는 종전 데스크톱 빌드의 성공을 요구한다', () => {
  const jobs = results()
  jobs.plan.outputs.parallel = 'false'
  jobs.native.result = 'skipped'
  assert.equal(summarize(jobs).ok, true)
  jobs.desktop.result = 'skipped'
  assert.equal(summarize(jobs).ok, false)
})
