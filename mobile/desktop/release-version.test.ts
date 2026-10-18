import { describe, expect, it } from 'vitest'
import { chooseRelease, parseReleaseVersion } from '../scripts/release-version.mjs'

describe('clean HNS release versions', () => {
  it('keeps the original development version and derives platform version numbers', () => {
    expect(parseReleaseVersion('0.35-a0-hns.7')).toMatchObject({ version: '0.35-a0-hns.7', revision: 7,
      numericVersion: '0.35.7', androidVersionCode: 3500007 })
  })
  it('increments the published revision and ignores legacy hash/mobile tags', () => {
    expect(chooseRelease(['hns-abc123', 'v0.35-a0-hns-mobile.1', 'v0.35-a0-hns.2', 'v0.35-a0-hns.8'], []).tag)
      .toBe('v0.35-a0-hns.9')
  })
  it('reuses the same version when a published source commit is rebuilt', () => {
    expect(chooseRelease(['v0.35-a0-hns.9'], ['v0.35-a0-hns.4']).version).toBe('0.35-a0-hns.4')
    expect(chooseRelease([], [], 'v0.35-a0-hns.3').version).toBe('0.35-a0-hns.3')
  })
  it('rejects malformed and out-of-range revisions', () => {
    for (const version of ['hns-abc123', '0.35-a0-hns.0', '0.35-a0-hns.01', '0.35-a0-hns.65536'])
      expect(() => parseReleaseVersion(version)).toThrow('Expected')
  })
})
