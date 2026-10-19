import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function summarize(needs) {
  const jobs = Object.entries(needs)
  const required = ['plan']
  if (needs.plan?.outputs?.tests === 'true') required.push('checks')
  if (needs.plan?.outputs?.build === 'true') {
    required.push('client', 'android', 'desktop')
    if (needs.plan.outputs.tests === 'true') required.push('engine', 'msvc', 'catch2')
    if (needs.plan.outputs.parallel === 'true') required.push('native')
  }
  if (needs.plan?.outputs?.extended === 'true')
    required.push('headers', 'universal', 'mingw', 'legacy_android', 'webserver', 'monster', 'docs')
  return {
    ok: required.every(name => needs[name]?.result === 'success')
      && jobs.every(([, job]) => !['failure', 'cancelled'].includes(job.result)),
    markdown: '| 단계 | 결과 |\n| --- | --- |\n'
      + jobs.map(([name, job]) => `| ${name} | ${job.result} |\n`).join(''),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = summarize(JSON.parse(process.env.NEEDS))
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown)
  if (!result.ok) process.exitCode = 1
}
