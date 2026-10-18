// Prod-only service worker registration (app-shell offline). Deferred past
// `load` so it never competes with first paint or the socket; `?nosw=1`
// skips it for debugging. Design: dev-material/service-worker-design.md.
import { isAndroidApp } from '../platform/android'

export function registerServiceWorker(): void {
  // Every asset is in the APK; a SW cache could retain an older APK's shell.
  if (isAndroidApp() || window.HnsDesktop?.bundled) return
  if (import.meta.env.DEV) return
  if (!('serviceWorker' in navigator)) return
  if (new URLSearchParams(location.search).get('nosw') === '1') {
    // Also retract an already-installed SW so the flag works for on-device
    // QA after a prod visit. Takes effect next launch (this page may stay
    // controlled); no auto-reload — surprising navigation isn't worth it.
    navigator.serviceWorker.getRegistration().then((reg) => reg?.unregister())
    return
  }
  const register = () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      const notify = (): void => { window.dispatchEvent(new Event('hns-game-bundled')) }
      const watch = (): void => { reg.installing?.addEventListener('statechange', () => {
        if (reg.installing?.state === 'installed' || reg.waiting || reg.active) notify()
      }) }
      watch(); reg.addEventListener('updatefound', watch)
      void navigator.serviceWorker.ready.then(notify)
    }).catch((err) => {
      console.warn('[sw] registration failed', err)
    })
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
