const { app, BrowserWindow, protocol, net, ipcMain, dialog } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve, join, sep, basename } = require('node:path')
const { pathToFileURL } = require('node:url')
app.setName('DCSS HNS')
if (process.env.HNS_DESKTOP_DATA) app.setPath('userData', process.env.HNS_DESKTOP_DATA)
if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(async () => {
  app.dock?.hide()
  const { createNativeSession } = require('./native-session.cjs')
  const packaged = join(process.resourcesPath, 'native')
  const native = createNativeSession(join(app.getPath('userData'), 'native'),
    require('node:fs').existsSync(join(packaged, 'desktop.json')) ? packaged : resolve(__dirname, '../sdl/native'))
  const trusted = event => {
    if (new URL(event.senderFrame?.url || 'about:blank').origin !== 'https://appassets.dcsshns.invalid') throw new Error('Untrusted native client request')
  }
  const menuActions = new Map()
  ipcMain.handle('hns-native-menu-started', (event, id) => {
    trusted(event)
    if (menuActions.get(id)?.sender !== event.sender) throw new Error('Invalid native menu request')
    native.menuStarted()
  })
  ipcMain.handle('hns-native-answer', (event, id, data, pack) => {
    trusted(event)
    const pending = menuActions.get(id)
    if (!pending || pending.sender !== event.sender || !(pack instanceof Uint8Array)
        || pack.byteLength > 128 * 1024 * 1024 || !data || typeof data !== 'object') throw new Error('Invalid native menu answer')
    menuActions.delete(id); pending.resolve({ data, pack })
  })
  ipcMain.handle('hns-native-import', async event => {
    trusted(event)
    const result = await dialog.showOpenDialog({ title: 'DCSS HNS · Import save backup',
      properties: ['openFile'], filters: [{ name: 'Save backup', extensions: ['pzsave'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const bytes = readFileSync(result.filePaths[0])
    if (bytes.byteLength > 128 * 1024 * 1024) throw new Error('Backup is too large')
    return new Uint8Array(bytes)
  })
  ipcMain.handle('hns-native-recover', event => { trusted(event); return native.recover() })
  ipcMain.handle('hns-native-finish', event => { trusted(event); native.finish() })
  ipcMain.handle('hns-native-checkpoint', event => { trusted(event); native.checkpoint() })
  ipcMain.handle('hns-native-compatible', (event, pack) => {
    trusted(event)
    if (!(pack instanceof Uint8Array) || pack.byteLength > 128 * 1024 * 1024) throw new Error('Invalid save compatibility request')
    return native.compatible(pack)
  })
  ipcMain.handle('hns-native-close', event => { trusted(event); if (!native.running) app.quit() })
  ipcMain.handle('hns-native-error', (event, message) => {
    trusted(event)
    if (typeof message !== 'string') throw new Error('Invalid error message')
    if (process.env.HNS_DESKTOP_UI_TEST) console.error(message)
    else dialog.showErrorBox('DCSS HNS', message)
  })
  ipcMain.handle('hns-native-export', async (event, name, bytes) => {
    trusted(event)
    if (typeof name !== 'string' || !(bytes instanceof Uint8Array) || bytes.byteLength > 128 * 1024 * 1024) throw new Error('Invalid file export')
    const options = {
      title: 'DCSS HNS · 파일 저장', defaultPath: join(app.getPath('documents'), basename(name)),
    }
    const result = await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, bytes)
    return true
  })
  ipcMain.handle('hns-native-play', async (event, name, pack) => {
    trusted(event)
    if (typeof name !== 'string' || !(pack instanceof Uint8Array) || pack.byteLength > 128 * 1024 * 1024) throw new Error('Invalid native game request')
    return native.play(name, pack, bytes => {
      if (!event.sender.isDestroyed()) event.sender.send('hns-native-saved', bytes)
    }, (action, bytes) => new Promise((resolve, reject) => {
      if (event.sender.isDestroyed()) { reject(new Error('Save service stopped')); return }
      menuActions.set(action.id, { sender: event.sender, resolve })
      event.sender.send('hns-native-action', action, bytes)
    }))
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
    const win = new BrowserWindow({ width: 1, height: 1, show: false, skipTaskbar: true,
      title: 'DCSS HNS save service', backgroundColor: '#000000',
      icon: join(root, 'desktop-assets/icon.png'),
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
        sandbox: true, nodeIntegration: false, webSecurity: true, offscreen: true, backgroundThrottling: false },
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('close', event => {
      if (!native.running) return
      event.preventDefault()
      native.checkpoint()
    })
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('https://appassets.dcsshns.invalid/')) event.preventDefault() })
    await win.loadURL('https://appassets.dcsshns.invalid/desktop-service.html')
  }
  await create()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void create() })
  app.on('second-instance', () => { native.checkpoint() })
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
