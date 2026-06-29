'use strict';

const fs = require('fs/promises');
const { parentPort, workerData } = require('worker_threads');

function normalizeVector(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => Number(x)).filter((x) => Number.isFinite(x));
}

async function imageData(ref) {
  if (ref && ref.path) return (await fs.readFile(ref.path)).toString('base64');
  if (ref && ref.buffer) return Buffer.from(ref.buffer).toString('base64');
  return '';
}

async function main() {
  const data = workerData || {};
  const western = data.western || {};
  const images = Array.isArray(data.images) ? data.images : [];
  const options = data.options || {};
  const bodyImages = [];

  for (let index = 0; index < images.length; index++) {
    bodyImages.push({
      imageId: `frame-${String(index).padStart(3, '0')}`,
      imageIndex: index,
      data: await imageData(images[index]),
      mimeType: 'image/jpeg',
    });
  }

  const body = {
    images: bodyImages,
    detect: true,
    returnCrops: true,
  };
  if (Array.isArray(options.blacklist) && options.blacklist.length) {
    body.blacklist = options.blacklist;
    body.blacklistThreshold = Number(options.blacklistThreshold) || 0.5;
  }

  const headers = { 'content-type': 'application/json' };
  if (data.faceApiKey) headers.authorization = `Bearer ${data.faceApiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5, Number(western.faceTimeoutSec) || 120) * 1000);
  try {
    const res = await fetch(data.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error && json.error.message || `HTTP ${res.status}`);
    const rows = Array.isArray(json.faces) ? json.faces : Array.isArray(json.data) ? json.data : [];
    const faces = rows.map((face, idx) => {
      const bbox = face.bbox || face.box || null;
      const area = bbox ? Math.max(0, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) : 0;
      return {
        faceId: String(face.faceId || face.id || `face-${idx + 1}`),
        clusterId: String(face.clusterId || face.faceId || face.id || `face-${idx + 1}`),
        imageIndex: Number.isFinite(Number(face.imageIndex)) ? Number(face.imageIndex) : 0,
        bbox,
        faceArea: area,
        detectionScore: Number(face.detectionScore) || 0,
        confidence: Number(face.confidence) || Number(face.detectionScore) || 0,
        embedding: normalizeVector(face.embedding || face.vector),
        sampleImageBase64: face.sampleImageBase64 || face.cropImageBase64 || '',
      };
    }).filter((face) => face.embedding.length > 0);
    parentPort.postMessage({ ok: true, faces });
  } finally {
    clearTimeout(timer);
  }
}

main().catch((err) => {
  parentPort.postMessage({ ok: false, error: err && err.message || String(err) });
});
