/**
 * Smoke-test a packaged PRISM: node scripts/smoke.mjs <path to PRISM.exe or prism>
 *
 * Launches the real binary, drives it over the Chrome DevTools Protocol (Node's
 * built-in WebSocket, no extra dependencies) through the Studio (circles, beat,
 * looper, undo and redo, saving and loading a loop), the visualizer and the oscilloscope with a built-in music track, saves
 * screenshots, and checks each Electron fuse against the attack it exists to stop.
 * Exits non-zero on any failure.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BIN = path.resolve(process.argv[2] ?? '');
const SHOT = path.resolve(process.argv[3] ?? 'smoke.png');
const PORT = 9333;
// Chromium refuses to run as root without this; only CI containers run as root.
const extra = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

function launch(args = [], env = {}) {
  return spawn(BIN, [...extra, ...args], { env: { ...process.env, ...env }, stdio: 'ignore', detached: process.platform !== 'win32' });
}

function stop(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* already gone */ }
}

/* ------------------------------ drive the app ------------------------------ */

async function cdp() {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = targets.find((t) => t.type === 'page' && t.url.startsWith('prism://'));
    } catch { /* not up yet */ }
  }
  if (!page) throw new Error('the app never exposed a prism:// page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method === 'Runtime.exceptionThrown') {
      errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
    } else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      errors.push(data.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value;
  };
  /** Poll until the expression is truthy; CI machines are slow, fixed sleeps lie. */
  const waitFor = async (expression, ms = 15000) => {
    const end = Date.now() + ms;
    let value;
    while (Date.now() < end) {
      value = await evaluate(expression).catch(() => undefined);
      if (value) return value;
      await sleep(250);
    }
    return value;
  };
  await send('Runtime.enable');
  return { send, evaluate, waitFor, errors, close: () => ws.close() };
}

async function drive() {
  console.log('app');
  // If something already answers on the port, we'd be testing that instead.
  const taken = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
  if (taken) throw new Error(`port ${PORT} is already in use — another instance is running`);
  const app = launch([`--remote-debugging-port=${PORT}`]);
  try {
    const { send, evaluate, waitFor, errors, close } = await cdp();
    const key = async (code, keyText, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyText, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyText, windowsVirtualKeyCode: vk, modifiers });
    };
    const loopState = () => evaluate("document.getElementById('loopBtn').dataset.state");

    // The Studio is the front page.
    const studio = await waitFor("document.readyState === 'complete' && location.href.endsWith('/studio.html') && document.title");
    check(studio === 'PRISM — Studio', 'opens on the Studio, from the bundled archive', await evaluate('location.href'));
    check((await evaluate('typeof require + typeof process')) === 'undefinedundefined', 'page has no Node access');
    check((await waitFor("document.querySelectorAll('.key').length")) === 18, 'studio keys built');
    const veil = await waitFor("document.getElementById('startVeil').hidden && 'running'", 8000);
    check(veil === 'running', 'audio starts without a click');
    // CI machines have no microphone: the page must say so, not break.
    const mic = await waitFor("(() => { const t = document.getElementById('micState').textContent; return !t.includes('starting') && t; })()", 10000);
    check(!!mic, 'microphone state settles', String(mic));
    const drawn = await waitFor(`(() => { const c = document.getElementById('beam'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4 * 3) if (d[i] > 40) lit++; return lit > 300 && lit; })()`, 10000);
    check(!!drawn, 'live circles draw (audio worklets under the CSP)', `${drawn} lit samples`);
    await evaluate(`document.querySelector('[data-beat="pulse"]').click(), true`);
    await key('Space', ' ', 32);
    check((await waitFor(`document.getElementById('loopBtn').dataset.state === 'recording' && 'recording'`, 5000)) === 'recording', 'Space starts a loop');
    await sleep(1500);
    await key('Space', ' ', 32);
    check((await waitFor(`document.getElementById('loopBtn').dataset.state === 'playing' && document.getElementById('loopLen').textContent`, 5000)) === '1 bar', 'the loop closes, snapped to a bar of the beat', await evaluate("document.getElementById('loopLen').textContent"));
    await key('Backspace', 'Backspace', 8);
    check((await waitFor(`document.getElementById('loopBtn').dataset.state === 'empty' && !document.getElementById('redoBtn').disabled && 'undone'`, 5000)) === 'undone', 'Backspace undoes the layer, and Redo is offered', await loopState());
    await key('Backspace', 'Backspace', 8, 8); // Shift
    check((await waitFor(`document.getElementById('loopBtn').dataset.state === 'playing' && 'playing'`, 5000)) === 'playing', 'Shift+Backspace redoes it', await loopState());
    await key('KeyS', 's', 83, 2); // Ctrl+S
    const saved = await waitFor(`(() => { const t = document.getElementById('libraryNote').textContent; return t.startsWith('Saved') && t; })()`, 8000);
    check(String(saved).startsWith('Saved'), 'Ctrl+S saves the loop to the library (IndexedDB on prism://)', String(saved || await evaluate("document.getElementById('libraryNote').textContent")));
    await key('Delete', 'Delete', 46);
    check((await waitFor(`document.getElementById('loopBtn').dataset.state === 'empty' && 'empty'`, 5000)) === 'empty', 'Delete clears the loop', await loopState());
    await evaluate(`document.querySelector('.library-item .lib-load').click(), true`);
    const reloaded = await waitFor(`document.getElementById('loopBtn').dataset.state === 'playing' && document.getElementById('libraryNote').textContent.startsWith('Loaded') && document.getElementById('loopLen').textContent`, 8000);
    check(reloaded === '1 bar', 'the saved loop loads back, on the beat', String(reloaded));
    await key('Delete', 'Delete', 46);
    await evaluate(`document.getElementById('libraryClose').click(), true`);
    await evaluate(`document.querySelector('[data-beat=""]').click(), true`);
    const studioShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT.replace(/\.png$/, '-studio.png'), Buffer.from(studioShot.result.data, 'base64'));

    await evaluate(`document.querySelector('a.page[href="./index.html"]').click()`);
    const loaded = await waitFor("location.href.endsWith('/index.html') && document.readyState === 'complete' && document.title");
    check(String(loaded).startsWith('PRISM'), 'visualizer loads', String(loaded));
    const keys = await waitFor("document.querySelectorAll('.key').length");
    check(keys === 18, 'keyboard built', `${keys} keys`);

    await evaluate(`document.querySelector('a.page[href="./scope.html"]').click()`);
    const scope = await waitFor("location.href.endsWith('/scope.html') && document.readyState === 'complete' && document.getElementById('musicPick') && document.title");
    check(scope === 'PRISM — Oscilloscope', 'oscilloscope page loads');

    await evaluate(`(() => { const p = document.getElementById('musicPick'); p.value = 't:cube'; p.dispatchEvent(new Event('change')); return true; })()`);
    const playing = await waitFor(`(() => { const t = document.getElementById('musicPick').selectedOptions[0].textContent + ' ' + document.getElementById('musicTime').textContent; return /0:0[1-9]/.test(t) && t; })()`, 20000)
      || await evaluate(`document.getElementById('musicPick').selectedOptions[0].textContent + ' ' + document.getElementById('musicTime').textContent`);
    check(/^Spinning Cube 0:0[1-9]/.test(playing), 'built-in music track plays', playing);

    await evaluate(`document.getElementById('liveBtn').click(), true`);
    const live = await waitFor(`(() => { const t = document.getElementById('musicName').textContent; return t.startsWith('live') && t; })()`, 10000);
    check(String(live).startsWith('live'), 'live circles start (audio-worklet module under the CSP)', String(live));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
    check(errors.length === 0, 'no errors in the page', errors.join(' | '));
    close();
  } finally {
    stop(app);
    await sleep(1500);
  }
}

/* ---------------------------------- fuses ---------------------------------- */

async function fuses() {
  console.log('fuses');
  const dir = mkdtempSync(path.join(tmpdir(), 'prism-fuse-'));
  const mark = path.join(dir, 'mark');
  const script = path.join(dir, 'inject.js');
  writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(mark)}, 'injected')`);

  // ELECTRON_RUN_AS_NODE=1 would normally turn the binary into a Node shell.
  let child = launch(['-e', `require('fs').writeFileSync(${JSON.stringify(mark)}, 'node')`], { ELECTRON_RUN_AS_NODE: '1' });
  await sleep(8000);
  stop(child);
  await sleep(1000);
  check(!existsSync(mark), 'ELECTRON_RUN_AS_NODE does not give a Node runtime');
  rmSync(mark, { force: true });

  // NODE_OPTIONS=--require would normally preload any script into the app.
  child = launch([], { NODE_OPTIONS: `--require ${script}` });
  await sleep(8000);
  stop(child);
  await sleep(1000);
  check(!existsSync(mark), 'NODE_OPTIONS --require does not inject code');

  // --inspect would normally open a Node debugger anyone local could attach to.
  child = launch(['--inspect=9339']);
  await sleep(8000);
  let open = false;
  try {
    open = (await fetch('http://127.0.0.1:9339/json/version', { signal: AbortSignal.timeout(2000) })).ok;
  } catch { /* nothing listening: good */ }
  stop(child);
  await sleep(1000);
  check(!open, '--inspect opens no debugger');
  rmSync(dir, { recursive: true, force: true });
}

if (!existsSync(BIN)) {
  console.error(`no binary at ${BIN}`);
  process.exit(2);
}
await drive();
await fuses();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
