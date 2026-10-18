import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { chooseRelease } from '../../mobile/scripts/release-version.mjs'

const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()
const lines = value => value.split('\n').filter(Boolean)
const sha = git(['rev-parse', 'HEAD'])
const release = chooseRelease(lines(git(['tag', '--list'])), lines(git(['tag', '--points-at', sha])), process.env.RELEASE_TAG || '')
appendFileSync(process.env.GITHUB_OUTPUT, `tag=${release.tag}\nsha=${sha}\nversion=${release.version}\n`, 'utf8')
console.log(`DCSS HNS ${release.version} (${sha.slice(0, 12)})`)
