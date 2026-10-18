// DEV-only window ring buffers (`__dcssWsLog`, `__dcssKbdLog`, …): the last
// `max` entries under window[name], readable from the console or, on a
// phone, Safari's remote inspector. Callers gate on import.meta.env.DEV so a
// prod build never touches window; the index of rings is CLAUDE.md's
// *Console hooks*.
export function devRingPush(name: string, max: number, entry: unknown): void {
  const w = window as unknown as Record<string, unknown>
  if (!Array.isArray(w[name])) w[name] = []
  const log = w[name] as unknown[]
  log.push(entry)
  if (log.length > max) log.splice(0, log.length - max)
}
