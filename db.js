'use strict';

// Storage on the device, using IndexedDB. Two stores:
//   records – one entry per omamori: the text fields plus a small thumbnail
//   photos  – the full-size (compressed) photos, keyed "<id>:front" / "<id>:back"
// Images are kept as { type, data: ArrayBuffer } rather than Blobs, because
// iOS Safari has had bugs where Blobs stored in IndexedDB become unreadable.
const DB = (() => {
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('omamori', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('records', { keyPath: 'id' });
          db.createObjectStore('photos', { keyPath: 'key' });
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => { db.close(); dbPromise = null; };
          resolve(db);
        };
        req.onerror = () => { dbPromise = null; reject(req.error); };
      });
    }
    return dbPromise;
  }

  function result(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function finished(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Saving was cancelled'));
    });
  }

  async function readStore(name) {
    const db = await open();
    return db.transaction(name, 'readonly').objectStore(name);
  }

  const photoKey = (id, side) => id + ':' + side;

  return {
    async allRecords() {
      return result((await readStore('records')).getAll());
    },

    async getRecord(id) {
      return result((await readStore('records')).get(id));
    },

    async getPhoto(id, side) {
      const photo = await result((await readStore('photos')).get(photoKey(id, side)));
      return photo ? { type: photo.type, data: photo.data } : null;
    },

    // Saves a record and its photo changes together.
    // photos.front / photos.back: { type, data } to store, null to delete, or leave out for no change.
    async save(record, photos = {}) {
      const db = await open();
      const tx = db.transaction(['records', 'photos'], 'readwrite');
      tx.objectStore('records').put(record);
      const store = tx.objectStore('photos');
      for (const side of ['front', 'back']) {
        const photo = photos[side];
        if (photo === null) store.delete(photoKey(record.id, side));
        else if (photo) store.put({ key: photoKey(record.id, side), type: photo.type, data: photo.data });
      }
      return finished(tx);
    },

    async remove(id) {
      const db = await open();
      const tx = db.transaction(['records', 'photos'], 'readwrite');
      tx.objectStore('records').delete(id);
      tx.objectStore('photos').delete(photoKey(id, 'front'));
      tx.objectStore('photos').delete(photoKey(id, 'back'));
      return finished(tx);
    },
  };
})();
