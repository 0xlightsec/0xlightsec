/**
 * Saved songs, kept inside the app (IndexedDB). Each entry's details and its data
 * are stored apart, so listing the library never reads whole songs.
 */

const DB = 'prism-daw';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function run(stores, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    Promise.resolve(work(tx, (r) => { result = r; })).catch(reject);
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('storage refused the save')); };
  });
}

/** Save a song; with an id, overwrite that entry. Returns its id. */
export function saveSong(info, json, id = null) {
  return run(['songs', 'data'], 'readwrite', async (tx, result) => {
    const store = tx.objectStore('songs');
    const entry = { ...info, size: json.length };
    const key = id === null ? await done(store.add(entry)) : (await done(store.put({ ...entry, id })), id);
    tx.objectStore('data').put(json, key);
    result(key);
  });
}

export function listSongs() {
  return run(['songs'], 'readonly', async (tx, result) => {
    const all = await done(tx.objectStore('songs').getAll());
    result(all.sort((a, b) => b.saved - a.saved));
  });
}

export function loadSongData(id) {
  return run(['data'], 'readonly', async (tx, result) => result(await done(tx.objectStore('data').get(id))));
}

export function deleteSong(id) {
  return run(['songs', 'data'], 'readwrite', (tx) => {
    tx.objectStore('songs').delete(id);
    tx.objectStore('data').delete(id);
  });
}
