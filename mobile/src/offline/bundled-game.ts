export interface BundledGame { build: string; version?: string; hns: true }
export function isBundledClient(): boolean {
  return (typeof window !== 'undefined' && (!!window.HnsAndroid || !!window.HnsDesktop?.bundled))
    || (typeof location !== 'undefined' && ['appassets.androidplatform.net','appassets.dcsshns.invalid'].includes(location.hostname))
}
function metadata(value: unknown): BundledGame | null {
  const v = value as Partial<BundledGame> | null
  return v?.hns === true && typeof v.build === 'string' && v.build
    ? {build:v.build,hns:true,...(typeof v.version === 'string' ? {version:v.version} : {})} : null
}
async function webBundle(): Promise<{cache: Cache; game: BundledGame} | null> {
  if (typeof caches === 'undefined' || typeof caches.keys !== 'function') return null
  let active: BundledGame | null = null
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    try {
      const r = await fetch('/offline/__bundled',{signal:AbortSignal.timeout(1000)})
      if (r.ok) active = metadata(await r.json())
    } catch { /* first install or an older shell */ }
  }
  for (const name of (await caches.keys()).filter(n=>n.startsWith('pz-shell-')).reverse()) {
    const cache = await caches.open(name), marker = await cache.match('/offline/__bundled')
    if (!marker) continue
    const game = metadata(await marker.json())
    if (game && (!active || active.build === game.build)) return {cache,game}
  }
  return null
}
export async function bundledGameVersion(): Promise<BundledGame | null> {
  try {
    if (isBundledClient()) {
      const response = await fetch('/offline/version.json',{signal:AbortSignal.timeout(1500)})
      return response.ok ? metadata(await response.json()) : null
    }
    return (await webBundle())?.game ?? null
  } catch { return null }
}
export async function bundledGameResponse(path: string): Promise<Response | undefined> {
  if (isBundledClient()) return undefined // Local host serves the immutable app files.
  try { return (await webBundle())?.cache.match(path) } catch { return undefined }
}
