'use strict';

const { app, BrowserWindow, protocol, net, ipcMain, shell } = require('electron');
const path = require('node:path');
const url = require('node:url');

const ROOT = path.join(__dirname, 'src');

// Serve the renderer over a privileged custom scheme instead of file://.
// This gives us a real (secure) origin, so ES modules, Web MIDI and
// getUserMedia all behave the way they do on the web.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'prism',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

/** Resolve a prism:// request to a file inside src/, refusing path escapes. */
function resolveRequest(requestUrl) {
  const { pathname } = new URL(requestUrl);
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.join(ROOT, relative);
  if (!target.startsWith(ROOT + path.sep) && target !== ROOT) return null;
  return target;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#05060a',
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  // Web MIDI and microphone are the whole point of the app; grant them.
  const GRANTED = new Set(['media', 'midi', 'midiSysex', 'audioCapture', 'fullscreen']);
  const session = win.webContents.session;
  session.setPermissionRequestHandler((_wc, permission, callback) => callback(GRANTED.has(permission)));
  session.setPermissionCheckHandler((_wc, permission) => GRANTED.has(permission));

  win.once('ready-to-show', () => win.show());

  win.on('focus', () => win.webContents.send('window:focus', true));
  win.on('blur', () => win.webContents.send('window:focus', false));
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false));

  // Keep navigation inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });

  win.loadURL('prism://app/index.html');
  return win;
}

app.whenReady().then(() => {
  protocol.handle('prism', (request) => {
    const target = resolveRequest(request.url);
    if (!target) return new Response('Forbidden', { status: 403 });
    return net.fetch(url.pathToFileURL(target).toString());
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---- window chrome controls (frameless window needs its own buttons) ---- */

function callerWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.on('window:minimize', (e) => callerWindow(e)?.minimize());
ipcMain.on('window:close', (e) => callerWindow(e)?.close());
ipcMain.on('window:toggle-maximize', (e) => {
  const win = callerWindow(e);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:toggle-fullscreen', (e) => {
  const win = callerWindow(e);
  if (win) win.setFullScreen(!win.isFullScreen());
});
ipcMain.handle('window:is-fullscreen', (e) => callerWindow(e)?.isFullScreen() ?? false);
