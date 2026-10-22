'use strict';

// Photo helpers: shrinking photos, and converting between the stored form
// ({ type, data: ArrayBuffer }), Blobs, and text (data URLs, used in backups).
const Images = {
  // Resize so the longest side is at most maxSide pixels, and save as JPEG.
  async compress(blob, maxSide, quality) {
    const img = await loadImage(blob);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not compress photo'))), 'image/jpeg', quality);
    });
    canvas.width = canvas.height = 0; // frees the memory straight away on iOS
    return out;
  },

  async toStored(blob) {
    return { type: blob.type || 'image/jpeg', data: await blob.arrayBuffer() };
  },

  toBlob(stored) {
    return new Blob([stored.data], { type: stored.type });
  },

  toDataURL(stored) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(Images.toBlob(stored));
    });
  },

  // The GPS position saved in a JPEG photo, as { lat, lng }, or null if it has none.
  async readGps(file) {
    try {
      const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
      if (view.getUint16(0) !== 0xFFD8) return null; // not a JPEG
      let pos = 2;
      while (pos + 10 <= view.byteLength) {
        const marker = view.getUint16(pos);
        if (marker === 0xFFE1 && view.getUint32(pos + 4) === 0x45786966) return readExifGps(view, pos + 10); // "Exif"
        if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) return null; // start of image data
        pos += 2 + view.getUint16(pos + 2);
      }
    } catch {
      // unreadable metadata just means no location
    }
    return null;
  },

  fromDataURL(url) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url || '');
    if (!match || !match[2]) throw new Error('Photo in backup is not readable');
    const binary = atob(match[3]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { type: match[1] || 'image/jpeg', data: bytes.buffer };
  },
};

// Finds the GPS tags in a photo's EXIF data. tiff is where the EXIF data starts.
function readExifGps(view, tiff) {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = offset => view.getUint16(tiff + offset, little);
  const u32 = offset => view.getUint32(tiff + offset, little);
  // Map of tag number -> position of that tag's entry
  const entries = ifd => {
    const found = {};
    for (let i = 0, n = u16(ifd); i < n; i++) found[u16(ifd + 2 + i * 12)] = ifd + 2 + i * 12;
    return found;
  };

  const main = entries(u32(4));
  if (!main[0x8825]) return null;
  const gps = entries(u32(main[0x8825] + 8));
  const letter = tag => (gps[tag] ? String.fromCharCode(view.getUint8(tiff + gps[tag] + 8)) : '');
  const degrees = tag => {
    if (!gps[tag]) return NaN;
    const at = u32(gps[tag] + 8);
    const part = i => u32(at + i * 8) / u32(at + i * 8 + 4);
    return part(0) + part(1) / 60 + part(2) / 3600;
  };

  let lat = degrees(2), lng = degrees(4);
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (letter(1) === 'S') lat = -lat;
  if (letter(3) === 'W') lng = -lng;
  return { lat, lng };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read photo')); };
    img.src = url;
  });
}
