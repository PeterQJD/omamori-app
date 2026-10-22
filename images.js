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

  // Tidies up a cut-out (an omamori with a see-through background, copied from
  // the Photos app): trims the empty space, keeps it to a sensible size, and
  // suggests a background: white for darker omamori, black for lighter ones.
  async prepareCutout(blob) {
    const img = await loadImage(blob);
    // Work at no more than 2000px: iPhone canvases can't hold full-size photos
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;

    let left = w, top = h, right = -1, bottom = -1, seeThrough = 0, brightness = 0, counted = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, alpha = px[i + 3];
        if (alpha < 250) seeThrough++;
        if (alpha > 20) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
        if (alpha > 128 && (x + y) % 4 === 0) {
          brightness += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          counted++;
        }
      }
    }
    if (right < 0 || seeThrough < w * h * 0.02) {
      canvas.width = canvas.height = 0;
      throw new Error('no-transparency');
    }

    const cropW = right - left + 1, cropH = bottom - top + 1;
    const fit = Math.min(1, 1200 / Math.max(cropW, cropH));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cropW * fit));
    out.height = Math.max(1, Math.round(cropH * fit));
    const outCtx = out.getContext('2d');
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(canvas, left, top, cropW, cropH, 0, 0, out.width, out.height);
    const cutout = await new Promise((resolve, reject) => {
      out.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process the cut-out'))), 'image/png');
    });
    canvas.width = canvas.height = out.width = out.height = 0;
    return { cutout, suggested: brightness / counted / 255 < 0.5 ? 'white' : 'black' };
  },

  // A 3:4 photo of the cut-out, centred on a plain background. "White" is a very
  // light grey and "black" a deep charcoal, as pure white and black looked too stark.
  async compose(cutout, background) {
    const img = await loadImage(cutout);
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background === 'black' ? '#262628' : '#efefed';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(0.84 * canvas.width / img.naturalWidth, 0.84 * canvas.height / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    const out = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not make the photo'))), 'image/jpeg', 0.85);
    });
    canvas.width = canvas.height = 0;
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
