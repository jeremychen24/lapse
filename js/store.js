// IndexedDB: every shot is saved the moment it's taken, so a crash,
// a lock screen or a killed tab never loses the timelapse.
// frames: JPEG ArrayBuffers (auto-increment keys keep them in order)
// meta:   the current session under the key 'session'

let dbp = null;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('lapse', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('frames', { autoIncrement: true });
      req.result.createObjectStore('meta');
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

// Frame and session meta are written in one transaction so they never disagree.
export const addFrame = (buf, meta) =>
  run(['frames', 'meta'], 'readwrite', (t) => {
    t.objectStore('frames').add(buf);
    t.objectStore('meta').put(meta, 'session');
  });

export const getFrame = (key) => run('frames', 'readonly', (t) => t.objectStore('frames').get(key));
export const frameKeys = () => run('frames', 'readonly', (t) => t.objectStore('frames').getAllKeys());
export const frameCount = () => run('frames', 'readonly', (t) => t.objectStore('frames').count());

export const clearAll = () =>
  run(['frames', 'meta'], 'readwrite', (t) => {
    t.objectStore('frames').clear();
    t.objectStore('meta').clear();
  });

// Ask the browser not to evict our data under storage pressure.
export const persist = () => navigator.storage?.persist?.().catch(() => {});
