const { app, BrowserWindow, protocol, net, ipcMain, dialog } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve, join, sep, basename } = require('node:path')
const { pathToFileURL } = require('node:url')
app.setName('DCSS HNS')
if (process.env.HNS_DESKTOP_DATA) app.setPath('userData', process.env.HNS_DESKTOP_DATA)
if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(async () => {
  const { createNativeSession } = require('./native-session.cjs')
  const packaged = join(process.resourcesPath, 'native')
  const native = createNativeSession(join(app.getPath('userData'), 'native'),
    require('node:fs').existsSync(join(packaged, 'desktop.json')) ? packaged : resolve(__dirname, '../sdl/native'))
  const trusted = event => {
    if (new URL(event.senderFrame?.url || 'about:blank').origin !== 'https://appassets.dcsshns.invalid') throw new Error('Untrusted native client request')
  }
  ipcMain.handle('hns-native-recover', event => { trusted(event); return native.recover() })
  ipcMain.handle('hns-native-finish', event => { trusted(event); native.finish() })
  ipcMain.handle('hns-native-checkpoint', event => { trusted(event); native.checkpoint() })
  ipcMain.handle('hns-native-close', event => { trusted(event); if (!native.running) app.quit() })
  ipcMain.handle('hns-native-show', event => { trusted(event); BrowserWindow.fromWebContents(event.sender)?.show() })
  ipcMain.handle('hns-native-export', async (event, name, bytes) => {
    trusted(event)
    if (typeof name !== 'string' || !(bytes instanceof Uint8Array) || bytes.byteLength > 128 * 1024 * 1024) throw new Error('Invalid file export')
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'DCSS HNS · 파일 저장', defaultPath: join(app.getPath('documents'), basename(name)),
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, bytes)
    return true
  })
  ipcMain.handle('hns-native-play', async (event, name, pack) => {
    trusted(event)
    if (typeof name !== 'string' || !(pack instanceof Uint8Array) || pack.byteLength > 128 * 1024 * 1024) throw new Error('Invalid native game request')
    BrowserWindow.fromWebContents(event.sender)?.hide()
    let result
    try { result = await native.play(name, pack, bytes => {
      if (!event.sender.isDestroyed()) event.sender.send('hns-native-saved', bytes)
    }) } catch (error) { BrowserWindow.fromWebContents(event.sender)?.show(); throw error }
    const win = BrowserWindow.fromWebContents(event.sender)
    if (result.manage || result.code) { win?.show(); win?.focus() }
    return result
  })
  const root = resolve(__dirname, 'web')
  const releaseVersion = JSON.parse(readFileSync(join(root, 'offline/version.json'), 'utf8')).version
  app.setAboutPanelOptions({ applicationName: 'DCSS HNS', applicationVersion: releaseVersion })
  ipcMain.on('hns-native-version', event => { event.returnValue = releaseVersion })
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
    const win = new BrowserWindow({ width: 1120, height: 800, minWidth: 900, minHeight: 600,
      title: 'DCSS HNS', backgroundColor: '#000000', show: !!process.env.HNS_DESKTOP_MANAGEMENT,
      icon: join(root, 'desktop-assets/icon.png'),
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
        sandbox: true, nodeIntegration: false, webSecurity: true },
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('close', event => {
      if (!native.running) return
      event.preventDefault()
      native.checkpoint()
      void dialog.showMessageBox(win, { type: 'info', title: 'DCSS HNS',
        message: '게임 창에서 S 키로 저장하고 종료한 뒤 관리 창을 닫으세요.', buttons: ['확인'] })
    })
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('https://appassets.dcsshns.invalid/')) event.preventDefault() })
    win.on('blur', () => win.webContents.executeJavaScript("window.dispatchEvent(new Event('hns-background'))").catch(() => {}))
    win.on('focus', () => win.webContents.executeJavaScript("window.dispatchEvent(new Event('hns-foreground'))").catch(() => {}))
    await win.loadURL('https://appassets.dcsshns.invalid/?offline=1' + (process.env.HNS_DESKTOP_MANAGEMENT ? '&manage=1' : ''))
    if (process.env.HNS_DESKTOP_SMOKE) {
      const result = await win.webContents.executeJavaScript(`(async () => {
        for (let n=0;n<100 && !document.querySelector('#desktop-cloud');n++) await new Promise(r=>setTimeout(r,50));
        document.querySelector('#desktop-cloud')?.click();
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
