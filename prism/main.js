'use strict';

const { app, BrowserWindow, protocol, net, ipcMain, shell } = require('electron');
const path = require('node:path');
const url = require('node:url');
const { isAppUrl, resolveRequest, permitted, isExternalAllowed } = require('./security.js');

const ROOT = path.join(__dirname, 'src');

/*
 * Hardening, following Electron's security checklist:
 *   - every renderer sandboxed, context isolation on, no Node in the page
 *   - permissions granted only to our own origin, and only the ones used
 *   - no navigation, new windows or <webview> outside the app
 *   - IPC accepted only from our own top-level frame
 *   - a strict Content-Security-Policy on every response
 *
 * The one window sets sandbox: true explicitly (Electron's default since v20).
 * app.enableSandbox() would also cover renderers created later, but the guards
 * below stop any other window or <webview> from being created at all.
 */

// Serve the renderer over a privileged custom scheme instead of file://.
// This gives it a real secure origin, so ES modules, audio worklets, Web MIDI
// and getUserMedia behave as they do on the web.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'prism',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

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
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  const session = win.webContents.session;
  session.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(permitted(permission, details.requestingUrl, details))
  );
  session.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) =>
    permitted(permission, requestingOrigin, details)
  );

  win.once('ready-to-show', () => win.show());

  win.on('focus', () => win.webContents.send('window:focus', true));
  win.on('blur', () => win.webContents.send('window:focus', false));
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false));

  win.loadURL('prism://app/index.html');
  return win;
}

/** Hand an https link the page asked to open to the system browser; drop anything else. */
function openOutside(target) {
  if (isExternalAllowed(target)) shell.openExternal(target);
}

// Applies to every web contents, so nothing created later slips past it.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // The window itself never leaves the app. Only an explicit open (window.open or
  // a target=_blank link) may reach the system browser, below.
  const stay = (event, target) => {
    if (!isAppUrl(target)) event.preventDefault();
  };
  contents.on('will-navigate', stay);
  contents.on('will-redirect', stay);
  contents.setWindowOpenHandler(({ url: target }) => {
    openOutside(target);
    return { action: 'deny' };
  });
});

app.whenReady().then(() => {
  protocol.handle('prism', async (request) => {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const target = resolveRequest(request.url, ROOT);
    if (!target) return new Response('Bad request', { status: 400 });
    const res = await net.fetch(url.pathToFileURL(target).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
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

/** The window behind an IPC message, but only if it came from our own top-level page. */
function callerWindow(event) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame || !isAppUrl(frame.url)) return null;
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
