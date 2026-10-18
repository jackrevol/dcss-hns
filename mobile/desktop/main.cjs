const { app, BrowserWindow, protocol, net } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve, join, sep } = require('node:path')
const { pathToFileURL } = require('node:url')
app.setName('DCSS HNS')
if (process.env.HNS_DESKTOP_DATA) app.setPath('userData', process.env.HNS_DESKTOP_DATA)
if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(async () => {
  const root = resolve(__dirname, 'web')
  const header = readFileSync(join(root, '_headers'), 'utf8')
    .split('\n').find(line => line.trim().startsWith('Content-Security-Policy:'))
    ?.trim().slice('Content-Security-Policy:'.length).trim()
  protocol.handle('https', async request => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'appassets.dcsshns.invalid') return net.fetch(request, { bypassCustomProtocolHandlers: true })
      if (request.method !== 'GET') return new Response('', { status: 403 })
      const target = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
      if (!target.startsWith(root + sep)) return new Response('', { status: 403 })
      const response = await net.fetch(pathToFileURL(target).toString())
      const headers = new Headers(response.headers)
      if (header) headers.set('Content-Security-Policy', header)
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, { status: response.status, headers })
    } catch { return new Response('', { status: 404 }) }
  })
  const create = async () => {
    const win = new BrowserWindow({ width: 1100, height: 850, minWidth: 380, minHeight: 600,
      title: 'DCSS HNS', backgroundColor: '#111111', show: !process.env.HNS_DESKTOP_SMOKE,
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
        sandbox: true, nodeIntegration: false, webSecurity: true },
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('https://appassets.dcsshns.invalid/')) event.preventDefault() })
    win.on('blur', () => win.webContents.executeJavaScript("window.dispatchEvent(new Event('hns-background'))").catch(() => {}))
    win.on('focus', () => win.webContents.executeJavaScript("window.dispatchEvent(new Event('hns-foreground'))").catch(() => {}))
    await win.loadURL('https://appassets.dcsshns.invalid/?offline=1')
    if (process.env.HNS_DESKTOP_SMOKE) {
      const result = await win.webContents.executeJavaScript(`(async () => {
        for (let n=0;n<100 && !document.querySelector('#offline-cloud');n++) await new Promise(r=>setTimeout(r,50));
        document.querySelector('#offline-cloud')?.click();
        const response = await fetch('/offline/version.json');
        return {secure:isSecureContext,locks:!!navigator.locks,idb:!!indexedDB,caches:!!window.caches,
          cloud:!!document.querySelector('#cloud-login-form'),version:await response.json(),errors:document.body.textContent.includes('failed to load')};
      })()`)
      console.log('HNS_DESKTOP_SMOKE', JSON.stringify(result))
      if (process.env.HNS_DESKTOP_SCREENSHOT) writeFileSync(process.env.HNS_DESKTOP_SCREENSHOT, (await win.webContents.capturePage()).toPNG())
      app.exit(result.secure && result.idb && result.caches && result.cloud && result.version.hns && !result.errors ? 0 : 1)
    }
  }
  await create()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void create() })
  app.on('second-instance', () => { const win = BrowserWindow.getAllWindows()[0]; win?.show(); win?.focus() })
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
