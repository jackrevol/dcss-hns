import { httpBaseOf, WsConnection } from '../ws/connection'
import type { ServerMsg } from '../ws/types'
import { listSessions, saveSession, type StoredSession } from '../auth/session'
import { SESSION_EXPIRED_NOTICE, tokenLogin } from '../auth/token-login'
import { findServer, KNOWN_SERVERS, SPECTATE_SERVERS, labelFor } from '../servers'
import { getLastSpectateServer, getPref, setPref, setLastSpectateServer, LOGIN_SPRITES_CHANGED_EVENT } from '../prefs'
import { openAboutDoc, openChangelogDoc, unreadDotHtml } from './docs'
import { openSettings } from './settings-view'
import { mountCardOverlay } from './overlay'
import { decorateLogo } from '../logo'
import { listAvatars } from '../avatars'
import { paintAvatars } from './avatar-tiles'
import { openCrypt } from './crypt-view'
import { getOfflineChars, loadOfflineSlots, type OfflineChar } from '../offline/offline-state'
import {
  canPlayOffline, INSTALL_SIZE_LABEL, probeReadiness, TILES_SIZE_LABEL,
  type Readiness,
} from '../offline/artifact-store'
import { compactPlace, nameTitle } from '../game/char-label'
import { escHtml } from '../game/dcss-colors'
import { MessageHold } from '../ws/message-hold'
import { registerViewDispose } from './view-dispose'

export interface LoginResult {
  conn: WsConnection
  username: string
  guest?: boolean
}

export function buildLoginView(
  onLogin: (result: LoginResult) => void,
  // Shown in the error slot on mount — how the app explains an involuntary
  // trip back here (connection lost, auto-resume gave up).
  notice?: string,
  // Opens the offline lobby (save slots for the on-device WASM engine). When
  // absent the offline card is not rendered.
  onOffline?: () => void,
  // Who was just signed out involuntarily with their session record gone:
  // the sign-in sheet fills in that server and username, so re-entry is the
  // password alone (rules at `refill` below).
  prefill?: { wsUrl: string; username: string },
): HTMLElement {
  const view = document.createElement('div')
  view.id = 'login-view'

  const sessions = listSessions()
  const hasSessions = sessions.length > 0

  // The sign-in form, rendered only inside the sheet (openSignInSheet).
  // One grouped cell: a Server row with its value
  // trailing, then Username / Password rows named by placeholder and
  // aria-label rather than a label line above each field. The error sits on
  // the fields it is about, above the button.
  const formInnerHtml = `
    <div class="login-form-group">
      <label class="login-form-row login-form-row--picker">
        <span class="login-form-name">Server</span>
        <select id="server-select"></select>
      </label>
      <div class="login-form-row">
        <input id="login-user" type="text" autocomplete="username" placeholder="Username"
               aria-label="Username" spellcheck="false" autocorrect="off" autocapitalize="off" required />
      </div>
      <div class="login-form-row">
        <input id="login-pass" type="password" autocomplete="current-password" placeholder="Password"
               aria-label="Password" required />
      </div>
    </div>
    <div id="login-sheet-error" class="login-sheet-error" role="alert" hidden></div>
    <button id="login-btn" type="submit" class="login-btn">Sign in</button>
  `

  // About / What's new are rendered in-app from the committed ABOUT.md /
  // CHANGELOG.md (see ./docs), so they ship in every build — this footer is the
  // always-present source/attribution surface required by the AGPL.
  const siteFooterHtml = `
    <div class="login-footer">
      <a href="#" id="login-about">About</a>
      <a href="#" id="login-changelog">What's new${unreadDotHtml()}</a>
      <!-- U+2699 GEAR + U+FE0E (text-presentation selector): without FE0E iOS
           Safari renders the gear as a colour emoji, ignoring the CSS colour.
           Same glyph as the in-game HUD chip (stats-view.ts settingsChip). -->
      <button id="login-settings" class="login-settings-chip" type="button"
              aria-label="Settings" title="Settings">&#x2699;&#xFE0E;</button>
    </div>
  `

  // "Add account" opens the sign-in sheet in both states; only its weight
  // follows the state. No saved accounts: it is the group's way in, so the
  // primary fill. Saved accounts: the cards are the way in, so a text action
  // under them. (Mock round r23; dev-material/login-add-account-sheet.md.)
  const addAccountSection = hasSessions
    ? `
      <div class="login-subsection">
        <button type="button" id="add-account" class="login-add-btn">Add account</button>
      </div>
    `
    : `
      <div class="login-subsection">
        <button type="button" id="add-account" class="login-btn">Add account</button>
      </div>
    `

  // The card is organized as two top-level mode groups — "Play online"
  // (accounts, sign-in, spectate: everything that talks to a WebTiles server)
  // and "Play offline" (the offline WASM engine) — so the two ways to play
  // read at a glance. Everything online-only must live inside the first
  // group; keep the offline group last and lean.
  //
  // Both groups are <details> disclosures so a player who uses only one
  // isn't scrolled past the other every launch. Group order never changes
  // with the state — collapsed, a group is one label line. Open/closed per
  // group: its pref when the user has toggled it (loginOnlineOpen /
  // loginOfflineOpen, see prefs.ts for the auto rule and the resets), else
  // auto — collapsed only when the other group alone shows use. A mount
  // notice always opens online: the notice slot lives inside it.
  const hasOfflineChars = !!onOffline && Object.keys(getOfflineChars()).length > 0
  const onlineOpen = !!notice || (getPref('loginOnlineOpen') ?? !(hasOfflineChars && !hasSessions))
  const offlineOpen = getPref('loginOfflineOpen') ?? !(hasSessions && !hasOfflineChars)

  view.innerHTML = `
    <div class="login-card">
      <h1 class="login-title">PocketZot</h1>
      <div id="login-avatars" class="login-avatars"></div>

      <section class="login-group">
        <details id="online-group" class="login-group-toggle"${onlineOpen ? ' open' : ''}>
        <summary class="login-group-label">Play online<span class="login-disclosure-hit"></span></summary>

        ${hasSessions ? `
        <div id="resume-section" class="login-subsection">
          <div id="resume-list" class="login-account-list"></div>
        </div>
        ` : ''}

        <div id="login-error" class="login-error" style="display:none" role="alert"></div>

        ${addAccountSection}

        <div class="login-subsection login-spectate-section">
          <div class="login-spectate-row">
            <select id="spectate-select" class="login-spectate-select" aria-label="Server"></select>
            <button id="spectate-btn" type="button" class="login-btn-spectate"
                    aria-describedby="spectate-note">Spectate</button>
          </div>
          <div id="spectate-error" class="login-error" style="display:none" role="alert"></div>
          <div id="spectate-note" class="login-sub-footer">Guest login.</div>
        </div>
        </details>
      </section>

      ${onOffline ? `
      <section id="offline-section" class="login-group">
        <details id="offline-group" class="login-group-toggle"${offlineOpen ? ' open' : ''}>
        <summary class="login-group-label">Play offline · HNS<span class="login-disclosure-hit"></span></summary>
        <button type="button" id="offline-card" class="login-account-card login-offline-card">
          <span class="login-account-tag">⌂</span>
          <span class="login-offline-lines">
            <span id="offline-title" class="login-account-username"></span>
            <span class="login-offline-subrow">
              <span id="offline-sub" class="login-offline-sub"></span>
              <span id="offline-count" class="login-offline-count"></span>
            </span>
          </span>
        </button>
        </details>
      </section>
      ` : ''}

      ${siteFooterHtml}
    </div>
  `

  const spectateSelect = view.querySelector<HTMLSelectElement>('#spectate-select')!
  const errorEl = view.querySelector<HTMLElement>('#login-error')!
  const spectateErrorEl = view.querySelector<HTMLElement>('#spectate-error')!

  decorateLogo(view.querySelector<HTMLElement>('.login-title')!)

  // Relocation notice, shown only on the exact public old origin (pocketzot.pages.dev)
  if (location.hostname === 'pocketzot.pages.dev' &&
      sessionStorage.getItem('pocketzot:moved-snooze') !== '1') {
    const banner = document.createElement('div')
    banner.className = 'login-moved'
    banner.innerHTML = `
      <button type="button" class="login-moved-x" aria-label="Dismiss">×</button>
      <p class="login-moved-msg">PocketZot has moved to <strong>pocketzot.app</strong>.</p>
      <a href="https://pocketzot.app/" class="login-moved-link">Open new site →</a>
      <p class="login-moved-sub">If you keep PocketZot on your home screen, re-add it from there.</p>
    `
    banner.querySelector('.login-moved-x')!.addEventListener('click', () => {
      sessionStorage.setItem('pocketzot:moved-snooze', '1')
      banner.remove()
    })
    view.querySelector('.login-card')!.prepend(banner)
  }

  // The signed-out identity fills the sheet whenever it opens — only for a
  // server the form can select (a username against the wrong server is
  // worse than an empty field). With a notice it also opens the sheet on
  // mount, carrying that notice. app.ts sends a prefill for every give-up
  // whose session record is gone — a reconnect cancel and the age cutoff
  // (no notice) included — so the notice alone says what happened.
  const refill = prefill && findServer(prefill.wsUrl) ? prefill : undefined
  const showNotice = (): void => { if (notice) showError(notice) }
  if (!refill) showNotice()

  // Hostnames, not the server tags: this is the home screen, where a visitor
  // without an account is the likeliest person to use it, and "CDI" means
  // nothing to them. The compressed row has the width for a hostname anyway
  // (measured) — the tag belongs in the lobby chip, which genuinely doesn't.
  for (const s of SPECTATE_SERVERS) {
    const o2 = document.createElement('option')
    o2.value = s.wsUrl; o2.textContent = s.label
    spectateSelect.appendChild(o2)
  }

  // Spectate dropdown prefers the saved pref (last explicit guest pick),
  // falling back to the most-recently-used session's server when that
  // server is also anonymously spectatable, otherwise the list top.
  const topSession = sessions[0]
  const savedSpectate = getLastSpectateServer()
  if (savedSpectate) {
    spectateSelect.value = savedSpectate
  } else if (topSession && SPECTATE_SERVERS.some(s => s.wsUrl === topSession.wsUrl)) {
    spectateSelect.value = topSession.wsUrl
  }

  view.querySelector('#login-about')!.addEventListener('click', (e) => {
    e.preventDefault()
    openAboutDoc()
  })
  view.querySelector('#login-changelog')!.addEventListener('click', (e) => {
    e.preventDefault()
    openChangelogDoc()
    view.querySelector('#login-changelog .unread-dot')?.remove()
  })
  view.querySelector('#login-settings')!.addEventListener('click', () => openSettings())

  // Browsers queue a `toggle` for a parsed-open <details> too, so only a
  // change from the mounted state is a user choice worth pinning. Returns a
  // programmatic opener that moves the baseline with it, so a forced open
  // (below) is never mistaken for a choice.
  const wireDisclosure = (id: string, mountedOpen: boolean, pref: 'loginOnlineOpen' | 'loginOfflineOpen'): (() => void) => {
    const group = view.querySelector<HTMLDetailsElement>(`#${id}`)
    if (!group) return () => {}
    let seen = mountedOpen
    group.addEventListener('toggle', () => {
      if (group.open === seen) return
      seen = group.open
      setPref(pref, seen)
    })
    return () => { seen = true; group.open = true }
  }
  const forceOnlineOpen = wireDisclosure('online-group', onlineOpen, 'loginOnlineOpen')
  wireDisclosure('offline-group', offlineOpen, 'loginOfflineOpen')

  // One disposer per view (the registry keeps the last one registered), so
  // every teardown of this view goes through this list.
  const teardown: Array<() => void> = []
  registerViewDispose(view, () => { for (const fn of teardown) fn() })
  // The open sign-in sheet's close (openSignInSheet), or null. Declared
  // before the mount-time open below reaches it.
  let closeSheet: (() => void) | null = null

  renderResumeButtons()
  renderOfflineCard()
  renderAvatars()

  view.querySelector('#add-account')!.addEventListener('click', () => openSignInSheet())
  if (refill && notice) openSignInSheet(notice)
  // The sheet is body-mounted: a view swapped out under it takes it along.
  teardown.push(() => closeSheet?.())

  // Shelf of your recently-played character dolls (see ../avatars + ./avatar-tiles),
  // newest at the left. One newest-first order is shared with the crypt grid (newest
  // top-left), so the visible row reads as the crypt's top row — the head you see
  // here is the same dolls in the same order that lead the full grid. Tapping the
  // row opens the crypt (the full history). The strip stays collapsed (`:empty`)
  // until at least one doll's atlas resolves, so the tap target only exists when
  // there's something to show.
  //
  // The whole shelf is gated on the loginSprites pref: painting is what pulls
  // the tile atlases, so when disabled we must not call paintAvatars at all —
  // the login screen then fetches no gamedata. With the strip :empty the crypt
  // (whose only entry point this is) is unreachable too, by construction.
  // Recipes keep being captured during play regardless, so re-enabling
  // restores a fully populated shelf. Live-apply handles the settings page
  // changing the pref over this still-mounted view.
  function renderAvatars(): void {
    const strip = view.querySelector<HTMLElement>('#login-avatars')
    if (!strip) return
    strip.setAttribute('role', 'button')
    strip.setAttribute('tabindex', '0')
    strip.setAttribute('aria-label', 'View all characters')
    const open = (): void => { if (strip.childElementCount) openCrypt() }
    strip.addEventListener('click', open)
    strip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
    })

    // Abort the previous paint before each repaint: paintAvatars resolves
    // atlases over several seconds and appends as they land, so a disable (or a
    // re-enable) mid-load could otherwise drop a superseded call's dolls into
    // the strip after we've cleared it, or duplicate them.
    let painting: AbortController | null = null
    const paint = (): void => {
      painting?.abort()
      if (getPref('loginSprites')) {
        painting = new AbortController()
        void paintAvatars(strip, listAvatars(), 2, 'login-avatar', { signal: painting.signal })
      } else {
        painting = null
        strip.innerHTML = ''
      }
    }
    paint()
    const onSpritesPref = (): void => paint()
    window.addEventListener(LOGIN_SPRITES_CHANGED_EVENT, onSpritesPref)
    // Each lobby drop mounts a fresh login view; without this every old one
    // stays reachable from window until the pref next changes.
    teardown.push(() => {
      window.removeEventListener(LOGIN_SPRITES_CHANGED_EVENT, onSpritesPref)
      painting?.abort()
    })
  }

  // Offline card: one tap opens the offline lobby (save slots, backup
  // management — views/offline-lobby.ts). With the group label naming the
  // action ("Play offline"), the card is titled like the online account
  // cards — by what you'll resume: the most recently played character, or
  // "New game" when no saves exist. The subline shows that character's
  // XL/place plus "+N more" when other saves exist, or the fixed
  // "On this device" when there's no character to describe. Slot presence
  // is guessed synchronously from the offline-state records, then corrected
  // by the IDB probe when the browser supports probing without side effects
  // (covers a wiped IDB under stale records, and an imported save with no
  // record). The card is always exactly two lines, so state swaps never
  // change its height.
  function renderOfflineCard(): void {
    const card = view.querySelector<HTMLButtonElement>('#offline-card')
    const title = view.querySelector<HTMLElement>('#offline-title')
    const sub = view.querySelector<HTMLElement>('#offline-sub')
    const count = view.querySelector<HTMLElement>('#offline-count')
    if (!card || !title || !sub || !count || !onOffline) return
    const setCard = (slots: string[], chars: Record<string, OfflineChar>): void => {
      count.textContent = ''
      // Records are keyed by live slots (reconciled, or slots came from the
      // records themselves), so the newest is just the newest value.
      const rec = slots.length > 0
        ? Object.values(chars).sort((a, b) => b.when - a.when)[0]
        : undefined
      hasChar = rec !== undefined
      // A character's name is game data (mono); the fallbacks are labels.
      title.classList.toggle('is-label', !rec)
      if (!rec) {
        // No saves, or saves the browser knows nothing about (imported
        // pack, wiped localStorage) — the lobby labels the latter by stem.
        title.textContent = slots.length === 0 ? 'New game'
          : slots.length === 1 ? 'Saved game' : `${slots.length} saved games`
        sub.textContent = 'On this device'
      } else {
        title.textContent = nameTitle(rec.name, rec.title)
        const parts: string[] = []
        if (rec.xl != null) parts.push(`XL:${rec.xl}`)
        if (rec.place) parts.push(compactPlace(rec.place, rec.depth))
        sub.textContent = parts.join(' ') || 'On this device'
        // Own span so the count survives when a long sub truncates.
        if (slots.length > 1) count.textContent = `+${slots.length - 1} more`
      }
      applyReadiness()
    }
    // Readiness, in the subline. A character to resume outranks it — that's
    // the card's whole point, and the pack is necessarily installed if
    // there's a character to name — so this speaks in two cases: nothing
    // installed yet (what it costs, so "installed the app for the flight but
    // never downloaded" is visible from the home screen), and installed with
    // nothing saved (what's on the device, so the first tap is informed).
    // Never a verdict about the device ("Not ready to play offline"): what's
    // installed, or what it would cost — the benefit is already on the group
    // label above it, and the lobby is one tap away for the longer sentence.
    // The lobby's fuller install-state wording doesn't fit here anyway: this
    // subline ellipsizes past ~27 characters (212px of room beside the
    // card's tag and chevron), and a truncated state is worse than a terse
    // one. It takes the whole line; squeezing flavor next to it truncates
    // both. Applied after every setCard repaint. A deploy that ships no
    // engine hides the whole section instead.
    let hasChar = false
    let readiness: Readiness | null = null
    const applyReadiness = (): void => {
      const r = readiness
      if (r === null) return
      const line = canPlayOffline(r)
        // Installed and playable: only worth a line when there's no
        // character to name, and only when the pack knows its own version
        // (older installs predate the stamp — "On this device" stands).
        ? (hasChar || r.state !== 'ready' || !r.version ? null : `DCSS ${r.version} installed`)
        // The price, not the state: the card's title is an action ("New
        // game", a character), so the line under it reads as what that tap
        // costs. The lobby row is about the pack itself and says "Not
        // installed · 22 MB" there.
        : r.state === 'not-cached' ? `${INSTALL_SIZE_LABEL} download`
          // Same size, and the tap can't spend it yet — so the blocker
          // replaces the price rather than qualifying it.
          : r.state === 'offline-not-cached' ? 'Needs a connection once'
            // Cache-less browser: no download fixes this, so don't price one.
            // The whole reason ("games need a connection") is a lobby-width
            // sentence; here the fact has to stand alone.
            : r.state === 'no-store' ? "Can't be installed here"
              // Engine cached, tiles half missing — finishable, and cheaper,
              // but only while the deploy can actually serve the rest: an
              // unreachable one gets the blocker (same as above), any other
              // non-ok answer no false advice.
              : r.state === 'ready'
                ? (r.deploy === 'ok' ? `${TILES_SIZE_LABEL} download left`
                  : r.deploy === 'unreachable' ? 'Needs a connection once' : null)
                : null
      if (line === null) return
      sub.textContent = line
      count.textContent = ''
    }
    const guess = getOfflineChars()
    setCard(Object.keys(guess), guess)
    void loadOfflineSlots().then(({ stems, chars }) => {
      if (view.isConnected) setCard(stems, chars)
    })
    void probeReadiness().then((r) => {
      if (!view.isConnected) return
      if (r.state === 'undeployed') {
        view.querySelector('#offline-section')?.remove()
        // Offline records with no offline offering (a build without the
        // engine) would otherwise leave a lone collapsed "Play online" line.
        forceOnlineOpen()
        return
      }
      readiness = r
      applyReadiness()
    })
    card.addEventListener('click', () => {
      card.disabled = true
      onOffline()
    })
  }

  function renderResumeButtons(): void {
    const section = view.querySelector<HTMLElement>('#resume-section')
    const list = view.querySelector<HTMLElement>('#resume-list')
    if (!section || !list) return
    list.innerHTML = ''
    const ss = listSessions()
    for (const s of ss) {
      const server = findServer(s.wsUrl)
      const tag = server?.tag ?? new URL(s.wsUrl).hostname.split('.')[0].slice(0, 4).toUpperCase()
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'login-account-card'
      card.innerHTML = `
        <span class="login-account-tag">${escHtml(tag)}</span>
        <span class="login-account-username">${escHtml(s.username)}</span>
      `
      card.addEventListener('click', () => resumeWithToken(s, card))
      list.appendChild(card)
    }
    if (ss.length === 0) section.hidden = true
  }

  async function resumeWithToken(s: StoredSession, card: HTMLButtonElement): Promise<void> {
    clearErrors()
    card.disabled = true

    const conn = new WsConnection(s.wsUrl)
    try {
      await conn.connect()
    } catch {
      showError(`Could not connect to ${labelFor(s.wsUrl)}`)
      card.disabled = false
      return
    }

    tokenLogin(conn, s, {
      onSuccess: (username, flush) => {
        // onLogin swaps in the lobby view, which takes over conn.onMessage;
        // flush() then replays the pre-login lobby snapshot into it.
        onLogin({ conn, username })
        flush()
      },
      onFail: () => {
        conn.close()
        showError(SESSION_EXPIRED_NOTICE)
        renderResumeButtons()
      },
    })
  }

  // The sign-in form's one host: a floating sheet at content height (the
  // Settings/docs sheet anatomy, mountCardOverlay), built fresh per open.
  // `againNotice`: opened on mount for an involuntary sign-out, titled as
  // such and carrying the app's notice (refill fills it in).
  function openSignInSheet(againNotice?: string): void {
    if (closeSheet) return
    const vv = window.visualViewport
    let pending: WsConnection | null = null
    let signedIn = false
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
    const { backdrop, body, close } = mountCardOverlay(
      againNotice ? 'Sign in again' : 'Add account',
      { backdrop: 'login-sheet-backdrop', card: 'login-sheet', body: 'login-sheet-body' },
      () => {
        closeSheet = null
        // A close mid-handshake (✕, Escape, scrim) must not sign in behind it.
        pending?.close()
        pending = null
        vv?.removeEventListener('resize', fitAboveKeyboard)
        vv?.removeEventListener('scroll', fitAboveKeyboard)
        if (signedIn) return
        // Dismissed without signing in: the reason it opened stays on the
        // screen, and focus returns to the control that opens it again.
        // Never ringed for a touch player: after the server <select>'s iOS
        // picker, WebKit rings this programmatic focus (on-device,
        // 2026-10-08; desktop WebKit doesn't reproduce).
        if (againNotice) showNotice()
        if (view.isConnected) {
          view.querySelector<HTMLElement>('#add-account')
            ?.focus({ preventScroll: true, ...(coarse && { focusVisible: false }) })
        }
      },
    )
    closeSheet = close
    body.innerHTML = `
      ${againNotice ? `<p id="login-sheet-msg" class="login-sheet-msg">${escHtml(againNotice)}</p>` : ''}
      <form id="login-form" autocomplete="on" novalidate>${formInnerHtml}</form>
      <p class="login-sheet-foot">No account?
        <a class="login-sheet-register" target="_blank" rel="noopener"></a>.<br>
        Pick a server near you for lower latency.</p>
    `
    const select = body.querySelector<HTMLSelectElement>('#server-select')!
    const userInput = body.querySelector<HTMLInputElement>('#login-user')!
    const passInput = body.querySelector<HTMLInputElement>('#login-pass')!
    const sheetError = body.querySelector<HTMLElement>('#login-sheet-error')!
    const btn = body.querySelector<HTMLButtonElement>('#login-btn')!
    const register = body.querySelector<HTMLAnchorElement>('.login-sheet-register')!

    // Region as group headers, not in the option text: "host · region"
    // overran the closed row for 7 of 9 servers at 402px and clipped the
    // region (measured 2026-10-08).
    const groups = new Map<string, HTMLOptGroupElement>()
    for (const s of KNOWN_SERVERS) {
      let g = groups.get(s.region)
      if (!g) {
        g = document.createElement('optgroup')
        g.label = s.region
        groups.set(s.region, g)
        select.appendChild(g)
      }
      const o = document.createElement('option')
      o.value = s.wsUrl; o.textContent = s.label
      g.appendChild(o)
    }
    // The signed-out identity, else the most-recently-used session's server.
    const initial = refill?.wsUrl ?? listSessions()[0]?.wsUrl
    if (initial && findServer(initial)) select.value = initial
    if (refill) userInput.value = refill.username
    // The server's own WebTiles page (httpBaseOf). A server can switch
    // sign-up off (new_accounts_disabled), which upstream reports only once
    // the register form is sent (userdb.py register_user).
    const syncRegister = (): void => {
      register.href = `${httpBaseOf(select.value)}/`
      register.textContent = `Register on ${labelFor(select.value)}`
    }
    syncRegister()
    select.addEventListener('change', syncRegister)

    // iOS leaves fixed layers under the on-screen keyboard: lift the sheet
    // by the part of the layout viewport the keyboard covers (the visual
    // viewport shrinks, and may pan to the focused field).
    // Pinch zoom (Safari tabs ignore user-scalable=no) shrinks the visual
    // viewport too, with no keyboard: only measure unzoomed.
    function fitAboveKeyboard(): void {
      if (!vv) return
      const covered = vv.scale > 1.01 ? 0 : Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      backdrop.style.setProperty('--kb', `${covered}px`)
      backdrop.classList.toggle('kb-up', covered > 0)
    }
    vv?.addEventListener('resize', fitAboveKeyboard)
    vv?.addEventListener('scroll', fitAboveKeyboard)

    // Never focus a field for a touch player: on iOS that focus raises the
    // system's "Sign In … Fill Password" autofill sheet over this one before
    // the form has been seen (on-device, 2026-10-08) — the player's own tap
    // on a field brings the keyboard or that prompt. Mouse and hardware
    // keyboards get the first empty field. Otherwise (and for the
    // sign-in-again sheet, which opens with no tap) the dialog itself takes
    // focus, so a screen reader moves into it without raising a keyboard.
    const card = body.parentElement!
    if (againNotice) card.setAttribute('aria-describedby', 'login-sheet-msg')
    if (!againNotice && !coarse) {
      (userInput.value ? passInput : userInput).focus()
    } else {
      card.tabIndex = -1
      card.focus({ preventScroll: true })
    }

    // Shown first, then filled, and emptied on every submit: a role=alert
    // region announces a content change, which a change while hidden — or
    // the same sentence set twice — may not be.
    const showSheetError = (msg: string): void => {
      sheetError.hidden = false
      sheetError.textContent = msg
    }
    const idle = (): void => {
      btn.disabled = false
      btn.textContent = 'Sign in'
    }

    body.querySelector<HTMLFormElement>('#login-form')!.addEventListener('submit', async (e) => {
      e.preventDefault()
      // The button is disabled while one is in flight; this also covers a
      // submit that doesn't come from it.
      if (pending) return
      sheetError.hidden = true
      sheetError.textContent = ''

      const wsUrl = select.value
      const username = userInput.value.trim()
      const password = passInput.value

      if (!username) { showSheetError('Please enter a username.'); return }
      if (!password) { showSheetError('Please enter a password.'); return }

      btn.disabled = true
      btn.textContent = 'Signing in…'

      const conn = new WsConnection(wsUrl)
      pending = conn
      try {
        await conn.connect()
      } catch {
        if (pending !== conn) return
        pending = null
        showSheetError(`Could not connect to ${labelFor(wsUrl)}`)
        idle()
        return
      }
      if (pending !== conn) return
      // Dropped before any login reply: no login_fail will come. adoptConn
      // (app.ts) takes onClose over once a login succeeds.
      conn.onClose = () => {
        if (pending !== conn) return
        pending = null
        showSheetError(`Lost the connection to ${labelFor(wsUrl)}`)
        idle()
      }

      conn.send({ msg: 'login', username, password })

      listenOnce(conn, (msg: ServerMsg) => {
        if (pending !== conn) return
        pending = null
        if (msg.msg === 'login_success') {
          setPref('loginOnlineOpen', null)  // a login outranks an old collapse; back to auto
          conn.onLoginCookie = (cookie, expiresDays) => {
            saveSession(wsUrl, msg.username, cookie, expiresDays)
          }
          conn.send({ msg: 'set_login_cookie' })
          signedIn = true
          close()
          onLogin({ conn, username: msg.username })
        } else if (msg.msg === 'login_fail') {
          // No reason = a plain password mismatch or unknown user
          // (ws_handler.py login); a reason ("Account is disabled.") is the
          // server's own sentence.
          showSheetError(msg.reason || 'Incorrect username or password.')
          conn.close()
          idle()
        }
      })
    })
  }

  const spectateBtn = view.querySelector<HTMLButtonElement>('#spectate-btn')!
  spectateBtn.addEventListener('click', async () => {
    clearErrors()
    const wsUrl = spectateSelect.value
    setLastSpectateServer(wsUrl)
    // The busy state pulses (login-busy) rather than relabelling: the
    // button's contents never change, so it can't resize and shove the
    // server picker's edge around mid-tap the way a "Connecting…" swap did.
    spectateBtn.disabled = true
    spectateBtn.classList.add('login-busy')
    spectateBtn.setAttribute('aria-busy', 'true')

    const conn = new WsConnection(wsUrl)
    try {
      await conn.connect()
    } catch {
      showSpectateError(`Could not connect to ${labelFor(wsUrl)}`)
      spectateBtn.disabled = false
      spectateBtn.classList.remove('login-busy')
      spectateBtn.removeAttribute('aria-busy')
      return
    }

    onLogin({ conn, username: '', guest: true })
  })

  function showError(msg: string): void {
    spectateErrorEl.style.display = 'none'
    errorEl.textContent = msg
    errorEl.style.display = ''
  }

  function showSpectateError(msg: string): void {
    errorEl.style.display = 'none'
    spectateErrorEl.textContent = msg
    spectateErrorEl.style.display = ''
  }

  function clearErrors(): void {
    errorEl.style.display = 'none'
    spectateErrorEl.style.display = 'none'
  }

  return view
}

// Install a one-shot handler that fires on the first login_success / login_fail.
// The handler typically swaps the view, which reassigns conn.onMessage to the
// next view's handler — in that case we leave the new handler in place. If the
// handler doesn't reassign (e.g. login_fail), restore the prior onMessage.
//
// The WebTiles server pushes the lobby snapshot (lobby_clear / lobby_entry /
// lobby_complete) immediately on socket open, before login_success arrives.
// Buffer those pre-login messages and replay them to whichever handler owns
// onMessage after the login handler runs, so the lobby view sees them.
export function listenOnce(conn: { onMessage: (msg: ServerMsg) => void }, handler: (msg: ServerMsg) => void): void {
  const prev = conn.onMessage
  const held = new MessageHold()
  const wrapper = (msg: ServerMsg) => {
    if (msg.msg === 'login_success' || msg.msg === 'login_fail') {
      handler(msg)
      if (conn.onMessage === wrapper) conn.onMessage = prev
      held.replay(conn)
    } else {
      held.hold(msg)
    }
  }
  conn.onMessage = wrapper
}
