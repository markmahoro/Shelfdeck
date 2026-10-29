'use strict';

const crypto = require('node:crypto');

// This cache owns only derived bytes. The caller must resolve current Inventory
// and perform its bounded physical read on every request before rendering.
function createCleanPosterRenderer({ sharp = require('sharp'), maxBytes = 32 * 1024 * 1024, maxEntries = 128 } = {}) {
  const cache = new Map(), pending = new Map();
  let usedBytes = 0;
  async function render(originalBytes, size) {
    const dimensions = size === 'wall' ? [360, 540] : size === 'detail' ? [720, 1080] : null;
    if (!dimensions) return originalBytes;
    const key = size + ':' + crypto.createHash('sha256').update(originalBytes).digest('hex');
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key); cache.set(key, cached);
      return cached;
    }
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      const bytes = await sharp(originalBytes).rotate().resize(...dimensions,
        { fit: 'cover', position: 'centre', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      if (bytes.length <= maxBytes && maxEntries > 0) {
        while (cache.size && (cache.size >= maxEntries || usedBytes + bytes.length > maxBytes)) {
          const oldest = cache.keys().next().value;
          usedBytes -= cache.get(oldest).length; cache.delete(oldest);
        }
        cache.set(key, bytes); usedBytes += bytes.length;
      }
      return bytes;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }
  return Object.freeze({ render });
}

module.exports = Object.freeze({ createCleanPosterRenderer });
