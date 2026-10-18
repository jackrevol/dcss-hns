// Hosts here must also be allowlisted in public/_headers (script-src + img-src)
// for tile sprites and tileinfo modules to load through the production CSP.
//
// `tag` is the official server acronym from the DCSS howto
// (https://crawl.develz.org/wordpress/howto), used as a compact label in
// places like the lobby header. `region` is the howto's stated location
// (checked 2026-10-08; comments below), coarsened to what a pick-the-
// nearest choice needs: US hosts by coast, Europe as one. It groups the
// sign-in picker (login.ts), in first-appearance order.
export interface KnownServer {
  label: string
  tag: string
  wsUrl: string
  region: string
}

export const KNOWN_SERVERS: KnownServer[] = [
  { label: 'crawl.dcss.io', tag: 'CDI', wsUrl: 'wss://crawl.dcss.io/socket', region: 'US East' }, // New York
  { label: 'crawl.akrasiac.org', tag: 'CAO', wsUrl: 'wss://crawl.akrasiac.org:8443/socket', region: 'US West' }, // Arizona
  { label: 'cbro.berotato.org', tag: 'CBR2', wsUrl: 'wss://cbro.berotato.org:8443/socket', region: 'US East' }, // Ohio
  { label: 'crawl.roguelikes.gg', tag: 'CRG', wsUrl: 'wss://crawl.roguelikes.gg/socket', region: 'US West' }, // Oregon
  { label: 'crawl-br.roguelikes.gg', tag: 'CBRG', wsUrl: 'wss://crawl-br.roguelikes.gg/socket', region: 'Brazil' },
  { label: 'crawl.xtahua.com', tag: 'CXC', wsUrl: 'wss://crawl.xtahua.com/socket', region: 'Europe' }, // France
  { label: 'underhound.eu', tag: 'CUE', wsUrl: 'wss://underhound.eu:8080/socket', region: 'Europe' }, // Amsterdam
  { label: 'crawl.nemelex.cards', tag: 'CNC', wsUrl: 'wss://crawl.nemelex.cards/socket', region: 'South Korea' },
  { label: 'crawl.project357.org', tag: 'CPO', wsUrl: 'wss://crawl.project357.org/socket', region: 'Australia' },
]

// CAO requires authentication for spectating, so it's excluded from the
// anonymous spectate dropdown.
export const SPECTATE_SERVERS: KnownServer[] = KNOWN_SERVERS.filter(
  s => s.tag !== 'CAO',
)

export function findServer(wsUrl: string): KnownServer | undefined {
  return KNOWN_SERVERS.find(s => s.wsUrl === wsUrl)
}

export function tagFor(wsUrl: string): string {
  return findServer(wsUrl)?.tag ?? new URL(wsUrl).hostname
}

export function labelFor(wsUrl: string): string {
  return findServer(wsUrl)?.label ?? wsUrl
}
