import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chooseRelease } from '../../mobile/scripts/release-version.mjs'

// 일반 실행은 실제 배포 대상과 두 컴파일러를 검사합니다.
// 원본의 전체 조합은 수동 확장 검사에서 그대로 사용할 수 있습니다.
export function linuxMatrix(extended) {
  if (!extended) return { include: [
    { compiler: 'gcc', build_opts: '', debug: 'FULLDEBUG=1', tag_upgrade: false, build_all: '' },
    { compiler: 'clang', build_opts: 'TILES=1', debug: 'FULLDEBUG=1', tag_upgrade: false, build_all: '' },
  ] }
  return {
    compiler: ['gcc', 'clang'], build_opts: ['', 'WEBTILES=1', 'WEBTILES=1 USE_DGAMELAUNCH=1', 'TILES=1'],
    debug: ['', 'FULLDEBUG=1'], tag_upgrade: [false], build_all: [''],
    exclude: [
      { compiler: 'gcc', build_opts: 'WEBTILES=1 USE_DGAMELAUNCH=1', debug: 'FULLDEBUG=1' },
      { compiler: 'clang', debug: '' },
      { compiler: 'clang', build_opts: 'WEBTILES=1 USE_DGAMELAUNCH=1' },
      { compiler: 'clang', build_opts: 'WEBTILES=1' },
    ],
    include: [
      ...['', 'WEBTILES=1 USE_DGAMELAUNCH=1', 'TILES=1'].map(build_opts =>
        ({ compiler: 'gcc', build_opts, debug: 'FULLDEBUG=1', tag_upgrade: true, build_all: '' })),
      ...['gcc', 'clang'].map(compiler =>
        ({ compiler, build_opts: 'TILES=1', debug: '', tag_upgrade: false, build_all: 'BUILD_ALL=1' })),
    ],
  }
}

export function planRun({ eventName, ref, inputs = {}, files = [] }) {
  const extended = eventName === 'workflow_dispatch' && inputs.extended === true
  const build = !['push', 'pull_request'].includes(eventName)
    || !files.length || files.some(path => !(/\.md$/i.test(path) || path.startsWith('crawl-ref/docs/')))
  const publish = build && (eventName === 'release'
    || eventName === 'push' && ref === 'refs/heads/master'
    || eventName === 'workflow_dispatch' && inputs.publish === true)
  return { build, publish, extended, linux: linuxMatrix(extended),
    msvc: extended ? { build_type: ['Debug Console', 'Debug Tiles', 'Release Console', 'Release Tiles'], build_arch: ['x64', 'Win32'] }
      : { include: [{ build_type: 'Debug Tiles', build_arch: 'Win32' }, { build_type: 'Release Tiles', build_arch: 'x64' }] } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()
  const requested = event.release?.tag_name || event.inputs?.tag || ''
  const sha = git(['rev-parse', requested ? `refs/tags/${requested}^{commit}` : `${process.env.GITHUB_SHA}^{commit}`])
  const base = event.pull_request?.base.sha || event.before
  const files = base && !/^0+$/.test(base)
    ? git(['diff', '--name-only', base, sha]).split('\n').filter(Boolean) : []
  const plan = planRun({ eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
    inputs: { publish: event.inputs?.publish === 'true', extended: event.inputs?.extended === 'true' }, files })
  const lines = value => value.split('\n').filter(Boolean)
  const release = chooseRelease(lines(git(['tag', '--list'])), lines(git(['tag', '--points-at', sha])), requested)
  const outputs = { ...plan, sha, version: release.version, tag: release.tag }
  for (const [key, value] of Object.entries(outputs))
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}\n`)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### DCSS HNS ${release.version}\n\n커밋: \`${sha}\`\n\n` +
    `패키지 빌드: ${plan.build} · 릴리즈 게시: ${plan.publish} · 확장 검사: ${plan.extended}\n`)
}
