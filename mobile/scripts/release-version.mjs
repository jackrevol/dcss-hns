import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
export const versionConfig = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8'))
export function parseReleaseVersion(version, upstream = versionConfig.upstream) {
  const prefix = upstream + '-hns.'
  const suffix = version.startsWith(prefix) ? version.slice(prefix.length) : ''
  if (!/^[1-9]\d*$/.test(suffix) || Number(suffix) > 65535) throw new Error(`Expected ${prefix}<revision 1–65535>, got ${version}`)
  const revision = Number(suffix), [major, minor] = upstream.split('-')[0].split('.')
  return { version, revision, upstream, numericVersion: `${major}.${minor}.${revision}`,
    androidVersionCode: Number(major) * 100_000_000 + Number(minor) * 100_000 + revision }
}
export function releaseVersion(directory = root, environment = process.env) {
  const saved = resolve(directory, 'release-info.json')
  const recorded = existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : undefined
  let version = environment.HNS_RELEASE_VERSION || recorded?.version
  if (!version && existsSync(resolve(directory, '../.git'))) {
    const tags = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    version = chooseRelease(tags(['tag', '--list']), tags(['tag', '--points-at', 'HEAD'])).version
  }
  const release = parseReleaseVersion(version || `${versionConfig.upstream}-hns.${versionConfig.revision}`)
  return { ...release, build: recorded?.version === release.version ? recorded.build : undefined }
}
export function chooseRelease(tags, tagsAtCommit, requested = '') {
  const versions = values => values.flatMap(tag => {
    try { return [{ tag, ...parseReleaseVersion(tag.replace(/^v/, '')) }] } catch { return [] }
  })
  if (requested) return { tag: requested, ...parseReleaseVersion(requested.replace(/^v/, '')) }
  const current = versions(tagsAtCommit).sort((a, b) => b.revision - a.revision)[0]
  if (current) return current
  const next = Math.max(versionConfig.revision - 1, ...versions(tags).map(value => value.revision)) + 1
  const value = parseReleaseVersion(`${versionConfig.upstream}-hns.${next}`)
  return { tag: 'v' + value.version, ...value }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(releaseVersion().version)
