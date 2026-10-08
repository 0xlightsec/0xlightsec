/**
 * Smoke-test a packaged PRISM: node scripts/smoke.mjs <path to PRISM.exe or prism>
 *
 * Launches the real binary, drives it over the Chrome DevTools Protocol (Node's
 * built-in WebSocket, no extra dependencies) through the Studio (circles, beat,
 * looper, undo and redo, saving and loading a loop, the piano roll), the visualizer and the oscilloscope with a built-in music track, saves
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

    const click = async (x, y, button = 'left') => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : 2, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
    };
    const centre = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const songState = (expr) => `(() => { const s = JSON.parse(localStorage.getItem('prism.daw.song.v1') || 'null'); if (!s) return false; const p = s.patterns.find((x) => x.id === s.current.pattern); return ${expr}; })()`;

    // The beatmaker (Studio) is the front page.
    const daw = await waitFor("document.readyState === 'complete' && location.href.endsWith('/daw.html') && document.title");
    check(daw === 'PRISM — Studio', 'opens on the Studio beatmaker, from the bundled archive', await evaluate('location.href'));
    check((await evaluate('typeof require + typeof process')) === 'undefinedundefined', 'page has no Node access');
    // Start from a fresh song: the app remembers the last session, and earlier runs leave one.
    await evaluate(`localStorage.removeItem('prism.daw.song.v1'), localStorage.removeItem('prism.daw.ui.v1'), location.reload(), true`);
    await sleep(500);
    await waitFor("document.readyState === 'complete' && document.querySelector('.ch-row') && true");
    check((await waitFor("document.querySelectorAll('.ch-row').length")) === 6, 'channel rack built: kick, clap, hat, snare, 808, pluck');
    check((await waitFor("document.getElementById('startVeil').hidden && 'running'", 8000)) === 'running', 'audio starts without a click');
    let at = await centre('.ch-row:nth-child(1) .step[data-step="0"]');
    await click(at.x, at.y);
    check((await waitFor(songState(`(p.notes[s.channels[0].id] || []).length`), 5000)) === 1, 'clicking a step puts a kick on it');
    await evaluate(`[...document.querySelectorAll('.br-name')].find((b) => b.textContent === 'Trap').click(), true`);
    const moving = await waitFor(`(() => { const t = document.getElementById('timeDisplay').textContent; return document.getElementById('playBtn').getAttribute('aria-label') === 'Stop' && t !== '1:1:1' && t; })()`, 8000);
    check(!!moving, 'a beat from the browser plays, and the transport moves', String(moving));
    await key('F9', 'F9', 120);
    const lit = await waitFor(`(() => { const c = document.querySelector('.mx-meter'); if (!c || !c.width) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n > c.width * 4 && n; })()`, 8000);
    check(!!lit, 'the mixer meters move with the beat', `${lit} lit pixels on the master meter`);
    await key('Space', ' ', 32);
    check((await waitFor(`document.getElementById('playBtn').getAttribute('aria-label') === 'Play' && 'stopped'`, 5000)) === 'stopped', 'Space stops');
    await key('F7', 'F7', 118);
    await sleep(300);
    const before = await evaluate(songState(`(p.notes[s.current.channel] || []).length`));
    at = await centre('#rollCanvas');
    await click(at.x, at.y);
    const after = await waitFor(songState(`(p.notes[s.current.channel] || []).length > ${before} && (p.notes[s.current.channel] || []).length`), 5000);
    check(after === before + 1, 'a click in the piano roll draws a note', `${before} -> ${after}`);
    await key('KeyZ', 'z', 90, 2); // Ctrl+Z
    const undone = await waitFor(songState(`(p.notes[s.current.channel] || []).length === ${before} && 'undone'`), 5000);
    check(undone === 'undone', 'Ctrl+Z takes the note back (no menu accelerator steals it)');
    await key('KeyS', 's', 83, 2); // Ctrl+S
    const savedSong = await waitFor(`(() => { const t = document.getElementById('songsNote').textContent; return t.startsWith('Saved') && t; })()`, 8000);
    check(String(savedSong).startsWith('Saved'), 'Ctrl+S saves the song (IndexedDB on prism://)', String(savedSong));
    await evaluate(`document.getElementById('songsClose').click(), true`);
    const rendered = await evaluate(`(async () => {
      const { newSong } = await import('./js/daw/model.js');
      const { DawEngine } = await import('./js/daw/engine.js');
      const s = newSong(); s.applyBeat(s.currentPattern.id, 'groove');
      const e = new DawEngine(s);
      const buf = await e.render('pattern', { tail: 0.5 });
      const d = buf.getChannelData(0); let sum = 0; for (const v of d) sum += v * v;
      return Math.sqrt(sum / d.length).toFixed(4) + ' rms over ' + (buf.length / buf.sampleRate).toFixed(2) + ' s';
    })()`);
    check(parseFloat(rendered) > 0.01, 'export renders the beat offline (WAV)', String(rendered));
    const dawShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT.replace(/\.png$/, '-daw.png'), Buffer.from(dawShot.result.data, 'base64'));

    // The live looper is the Live page now.
    await evaluate(`document.querySelector('a.page[href="./studio.html"]').click()`);
    const studio = await waitFor("location.href.endsWith('/studio.html') && document.readyState === 'complete' && document.getElementById('loopBtn') && document.title");
    check(studio === 'PRISM — Live', 'the Live page (looper and circles) loads', String(studio));
    check((await waitFor("document.querySelectorAll('.key').length")) === 18, 'live page keys built');
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
    // Piano roll: open it, draw a note with the mouse, close it.
    await key('KeyN', 'n', 78);
    check((await waitFor(`!document.getElementById('roll').hidden && 'open'`, 5000)) === 'open', 'N opens the piano roll');
    await sleep(300);
    const rollAt = await centre('#rollCanvas');
    await click(rollAt.x, rollAt.y);
    const rollNotes = await waitFor(`(() => { const n = JSON.parse(localStorage.getItem('prism.studio.v1') || '{}').roll?.pattern?.notes?.length; return n > 0 && n; })()`, 5000);
    check(rollNotes >= 1, 'a click draws a note in the roll', `${rollNotes} note(s)`);
    await key('KeyN', 'n', 78);
    await evaluate(`document.querySelector('[data-beat=""]').click(), true`);
    const studioShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT.replace(/\.png$/, '-live.png'), Buffer.from(studioShot.result.data, 'base64'));

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
