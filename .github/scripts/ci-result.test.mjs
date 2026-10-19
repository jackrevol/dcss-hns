import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarize } from './ci-result.mjs'

const stages = ['plan', 'checks', 'client', 'android', 'native', 'desktop', 'engine', 'msvc', 'catch2',
  'headers', 'universal', 'mingw', 'legacy_android', 'webserver', 'monster', 'docs']
const builds = ['client', 'android', 'native', 'desktop']
function results(build = true, extended = false, tests = extended) {
  const required = ['plan', ...(build ? builds : []), ...(tests ? ['checks', ...(build ? ['engine', 'msvc', 'catch2'] : [])] : [])]
  return Object.fromEntries(stages.map(name => [name, {
    result: extended || required.includes(name) ? 'success' : 'skipped',
    outputs: name === 'plan' ? { build: String(build), extended: String(extended), tests: String(tests), parallel: 'true' } : {},
  }]))
}
test('일반 빌드는 단위·실행·추가 컴파일 검사를 생략해도 게시한다', () => {
  const result = summarize(results())
  assert.equal(result.ok, true)
  assert.match(result.markdown, /\n\| desktop \| success \|\n/)
})
test('문서 변경은 계획 외 작업을 모두 생략한다', () => {
  const jobs = results(false)
  assert.equal(summarize(jobs).ok, true)
  assert.equal(jobs.checks.result, 'skipped')
})
test('앱 빌드가 생략되거나 실패하거나 취소되면 게시를 막는다', () => {
  for (const result of ['skipped', 'failure', 'cancelled']) {
    for (const name of builds) {
      const jobs = results()
      jobs[name].result = result
      assert.equal(summarize(jobs).ok, false)
    }
  }
})
test('수동 테스트 선택 시 검사 누락·실패·취소도 게시를 막는다', () => {
  assert.equal(summarize(results(true, false, true)).ok, true)
  for (const result of ['skipped', 'failure', 'cancelled']) {
    for (const name of ['checks', 'engine', 'msvc', 'catch2']) {
      const jobs = results(true, false, true)
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
