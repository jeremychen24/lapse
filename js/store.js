// IndexedDB: the recording is saved as it's made, so a crash, a lock screen or a killed tab
// never loses it. It's deleted as soon as the finished video is saved.
// chunks: encoded H.264 pieces { ts, dur, key, data } (auto-increment keys keep them in order)
// frames: JPEG shots, only from sessions recorded before version 3 (finish-only, then gone)
// meta:   the current session under the key 'session'
// log:    one entry per finished timelapse, for Stats (see timelog.js)

let dbp = null;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('lapse', 3);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      if (e.oldVersion < 1) {
        d.createObjectStore('frames', { autoIncrement: true });
        d.createObjectStore('meta');
      }
      if (e.oldVersion < 2) d.createObjectStore('log', { keyPath: 'id' });
      if (e.oldVersion < 3) d.createObjectStore('chunks', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run(stores, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(stores, mode);
        const req = fn(t);
        let out;
        if (req) req.onsuccess = () => (out = req.result);
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('aborted'));
      }),
  );
}

export const getMeta = () => run('meta', 'readonly', (t) => t.objectStore('meta').get('session'));

export const putMeta = (meta) =>
  run('meta', 'readwrite', (t) => void t.objectStore('meta').put(meta, 'session'));

// A video piece and the session meta are written in one transaction so they never disagree.
export const addChunk = (chunk, meta) =>
  run(['chunks', 'meta'], 'readwrite', (t) => {
    t.objectStore('chunks').add(chunk);
    t.objectStore('meta').put(meta, 'session');
  });

export const getChunk = (key) => run('chunks', 'readonly', (t) => t.objectStore('chunks').get(key));
export const chunkKeys = () => run('chunks', 'readonly', (t) => t.objectStore('chunks').getAllKeys());
export const chunkCount = () => run('chunks', 'readonly', (t) => t.objectStore('chunks').count());

// Old-format sessions (JPEG shots) can still be finished.
export const getFrame = (key) => run('frames', 'readonly', (t) => t.objectStore('frames').get(key));
export const frameKeys = () => run('frames', 'readonly', (t) => t.objectStore('frames').getAllKeys());
export const frameCount = () => run('frames', 'readonly', (t) => t.objectStore('frames').count());

// Deletes the recording (never the stats log).
export const clearAll = () =>
  run(['chunks', 'frames', 'meta'], 'readwrite', (t) => {
    t.objectStore('chunks').clear();
    t.objectStore('frames').clear();
    t.objectStore('meta').clear();
  });

export const putLog = (entry) => run('log', 'readwrite', (t) => void t.objectStore('log').put(entry));
export const getLog = () => run('log', 'readonly', (t) => t.objectStore('log').getAll());

// Ask the browser not to evict our data under storage pressure.
export const persist = () => navigator.storage?.persist?.().catch(() => {});
