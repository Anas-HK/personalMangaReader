const { app, BrowserWindow, ipcMain, dialog, Menu, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif',
};

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const DEFAULT_LIBRARY_ROOT = 'C:\\DownloadedMaterial\\coms';

const STATE_PATH = path.join(app.getPath('userData'), 'state.json');
const WINDOW_PATH = path.join(app.getPath('userData'), 'window.json');

let mainWindow = null;
let pipWindow = null;
let state = { libraryRoot: DEFAULT_LIBRARY_ROOT, series: {} };

protocol.registerSchemesAsPrivileged([
  { scheme: 'asset', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

async function loadJSON(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}
async function saveJSON(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2));
}

function naturalKey(s) {
  return String(s).split(/(\d+(?:\.\d+)?)/).filter(Boolean).map(p => {
    const n = parseFloat(p);
    return Number.isFinite(n) && /^\d/.test(p) ? n : p.toLowerCase();
  });
}
function naturalCompare(a, b) {
  const ak = naturalKey(a), bk = naturalKey(b);
  const len = Math.max(ak.length, bk.length);
  for (let i = 0; i < len; i++) {
    const x = ak[i], y = bk[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = typeof x === 'number', yn = typeof y === 'number';
    if (xn && yn) { if (x !== y) return x - y; }
    else {
      const xs = String(x), ys = String(y);
      if (xs < ys) return -1;
      if (xs > ys) return 1;
    }
  }
  return 0;
}

async function listImages(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter(f => IMG_EXT.has(path.extname(f).toLowerCase()))
      .sort(naturalCompare);
  } catch { return []; }
}

async function readSeriesMeta(seriesPath) {
  let entries;
  try { entries = await fs.readdir(seriesPath, { withFileTypes: true }); }
  catch { return null; }
  const chapterDirs = entries.filter(e => e.isDirectory() && /\d/.test(e.name));
  if (!chapterDirs.length) return null;
  let totalPages = 0;
  let validChapters = 0;
  for (const c of chapterDirs) {
    const imgs = await listImages(path.join(seriesPath, c.name));
    if (imgs.length) { totalPages += imgs.length; validChapters++; }
  }
  if (validChapters === 0 || totalPages === 0) return null;
  let cover = null;
  for (const c of ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp']) {
    try { await fs.access(path.join(seriesPath, c)); cover = path.join(seriesPath, c); break; } catch {}
  }
  if (!cover) {
    const sorted = chapterDirs.slice().sort((a, b) => naturalCompare(a.name, b.name));
    for (const c of sorted) {
      const imgs = await listImages(path.join(seriesPath, c.name));
      if (imgs.length) { cover = path.join(seriesPath, c.name, imgs[0]); break; }
    }
  }
  return { chapters: validChapters, totalPages, coverPath: cover };
}

async function scanLibrary(root) {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (e) { return { error: e.message, series: [] }; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(root, e.name);
    const meta = await readSeriesMeta(full);
    if (meta) out.push({ name: e.name, path: full, ...meta });
  }
  out.sort((a, b) => naturalCompare(a.name, b.name));
  return { error: null, series: out };
}

async function scanChapters(seriesPath) {
  let entries;
  try { entries = await fs.readdir(seriesPath, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !/\d/.test(e.name)) continue;
    const full = path.join(seriesPath, e.name);
    const imgs = await listImages(full);
    if (imgs.length) out.push({ name: e.name, path: full, pages: imgs.length, images: imgs });
  }
  out.sort((a, b) => naturalCompare(a.name, b.name));
  return out;
}

function handleAssetProtocol() {
  protocol.handle('asset', async (request) => {
    let localPath = '?';
    try {
      const u = new URL(request.url);
      let p;
      if (u.hostname && /^[a-z]$/i.test(u.hostname)) {
        p = u.hostname.toUpperCase() + ':' + u.pathname;
      } else {
        p = u.pathname;
        if (p.startsWith('/')) p = p.slice(1);
      }
      p = decodeURIComponent(p);
      localPath = process.platform === 'win32' ? p.replace(/\//g, '\\') : p;
      const data = await fs.readFile(localPath);
      const ext = path.extname(localPath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      console.log(`[asset OK] ${request.url}`);
      return new Response(data, {
        headers: { 'Content-Type': mime }
      });
    } catch (e) {
      console.error(`[asset ERR] url=${request.url} path=${localPath} :: ${e.message}`);
      return new Response(`Asset error: ${e.message}`, { status: 404 });
    }
  });
}

async function createMainWindow() {
  const saved = await loadJSON(WINDOW_PATH, { width: 1280, height: 820, x: undefined, y: undefined });
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#0a0a0c',
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  await mainWindow.loadFile('renderer/index.html');
  mainWindow.show();
  const save = async () => {
    if (mainWindow.isDestroyed() || mainWindow.isFullScreen() || mainWindow.isMaximized()) return;
    const b = mainWindow.getBounds();
    await saveJSON(WINDOW_PATH, b);
  };
  mainWindow.on('resize', save);
  mainWindow.on('move', save);
}

function createPipWindow(query) {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.focus();
    return pipWindow;
  }
  pipWindow = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 220,
    minHeight: 220,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0a0a0c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    }
  });
  const qs = new URLSearchParams({ mode: 'pip', ...query }).toString();
  pipWindow.loadFile('renderer/index.html', { search: qs });
  pipWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      pipWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  pipWindow.once('ready-to-show', () => pipWindow.show());
  pipWindow.on('closed', () => { pipWindow = null; });
  return pipWindow;
}

ipcMain.handle('state:get', () => state);
ipcMain.handle('state:set', async (_e, next) => {
  state = next;
  await saveJSON(STATE_PATH, state);
  return true;
});
ipcMain.handle('state:merge-series', async (_e, name, patch) => {
  state.series = state.series || {};
  state.series[name] = Object.assign(state.series[name] || {}, patch, {
    lastOpenedAt: new Date().toISOString()
  });
  await saveJSON(STATE_PATH, state);
  return state.series[name];
});

ipcMain.handle('library:scan', async (_e, root) => scanLibrary(root || state.libraryRoot));
ipcMain.handle('chapters:scan', async (_e, p) => scanChapters(p));

ipcMain.handle('library:pick-root', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Pick library folder',
    properties: ['openDirectory'],
    defaultPath: state.libraryRoot
  });
  if (result.canceled || !result.filePaths.length) return null;
  state.libraryRoot = result.filePaths[0];
  await saveJSON(STATE_PATH, state);
  return state.libraryRoot;
});

ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.handle('window:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return false;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
  return w.isMaximized();
});
ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.handle('window:toggle-aot', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return false;
  const next = !w.isAlwaysOnTop();
  w.setAlwaysOnTop(next);
  return next;
});
ipcMain.handle('window:is-aot', (e) => !!BrowserWindow.fromWebContents(e.sender)?.isAlwaysOnTop());
ipcMain.handle('window:toggle-fullscreen', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return false;
  const next = !w.isFullScreen();
  w.setFullScreen(next);
  return next;
});
ipcMain.handle('window:is-fullscreen', (e) => !!BrowserWindow.fromWebContents(e.sender)?.isFullScreen());
ipcMain.handle('window:is-pip', () => !!pipWindow && !pipWindow.isDestroyed());
ipcMain.handle('window:open-pip', (_e, info) => { createPipWindow(info || {}); return true; });
ipcMain.handle('window:close-pip', () => {
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
  return true;
});

app.whenReady().then(async () => {
  state = await loadJSON(STATE_PATH, { libraryRoot: DEFAULT_LIBRARY_ROOT, series: {} });
  if (!state.libraryRoot) state.libraryRoot = DEFAULT_LIBRARY_ROOT;
  handleAssetProtocol();
  await createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
