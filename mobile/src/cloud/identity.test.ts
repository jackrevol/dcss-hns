import { expect, it } from 'vitest'
import { normalizeUsername } from './identity'

it('uses one canonical account across native and browser clients', () => {
  expect(normalizeUsername(' Player_123 ')).toBe('player_123')
  expect(normalizeUsername('PLAYER_123')).toBe('player_123')
})
it.each(['a', 'a'.repeat(33), 'user@example.com', 'abc def', 'abc.def', '사용자', 'abc+def', ''])('rejects invalid account IDs: %s', name => {
  expect(() => normalizeUsername(name)).toThrow(/아이디/)
})
