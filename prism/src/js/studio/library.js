/**
 * Your saved loops, kept inside the app (IndexedDB), so saving is one click.
 * Each entry's details and its audio are stored apart, so listing the library
 * never reads megabytes of audio. Files (.prism) are for keeping or sharing
 * outside the app.
 */

const DB = 'prism-studio';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('loops')) db.createObjectStore('loops', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(stores, mode, work) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    Promise.resolve(work(tx, (r) => { result = r; })).catch(reject);
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('storage refused the save')); };
  }));
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Save a loop: `info` is what the list shows, `bytes` the .prism file. Returns its id. */
export function saveLoop(info, bytes) {
  return run(['loops', 'audio'], 'readwrite', async (tx, result) => {
    const id = await done(tx.objectStore('loops').add({ ...info, size: bytes.byteLength }));
    tx.objectStore('audio').put(bytes, id);
    result(id);
  });
}

/** Every saved loop's details, newest first. */
export function listLoops() {
  return run(['loops'], 'readonly', async (tx, result) => {
    const all = await done(tx.objectStore('loops').getAll());
    result(all.sort((a, b) => b.saved - a.saved));
  });
}

export function loadLoop(id) {
  return run(['audio'], 'readonly', async (tx, result) => result(await done(tx.objectStore('audio').get(id))));
}

export function deleteLoop(id) {
  return run(['loops', 'audio'], 'readwrite', (tx) => {
    tx.objectStore('loops').delete(id);
    tx.objectStore('audio').delete(id);
  });
}

export function renameLoop(id, name) {
  return run(['loops'], 'readwrite', async (tx) => {
    const store = tx.objectStore('loops');
    const entry = await done(store.get(id));
    if (entry) store.put({ ...entry, name });
  });
}
