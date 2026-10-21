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

  fromDataURL(url) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url || '');
    if (!match || !match[2]) throw new Error('Photo in backup is not readable');
    const binary = atob(match[3]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { type: match[1] || 'image/jpeg', data: bytes.buffer };
  },
};

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read photo')); };
    img.src = url;
  });
}
