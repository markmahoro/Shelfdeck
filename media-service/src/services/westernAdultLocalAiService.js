'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');

const transcodeService = require('./transcodeService');
const peopleStore = require('../personCatalogStore');

let sharpModule;
const INTERNAL_FACE_EMBEDDINGS_URL = 'http://127.0.0.1:19110/v1/face/embeddings';

function safeId(value) {
  return String(value || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function safeName(value, fallback = 'Scene') {
  const cleaned = String(value || fallback || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return (cleaned || fallback || 'Scene').slice(0, 180);
}

function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try { sharpModule = require('sharp'); } catch (_) { sharpModule = null; }
  return sharpModule;
}

function runCmd(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, ...opts });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, out, err }));
  });
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function ffprobeDuration(config, sourcePath) {
  const r = await runCmd(transcodeService.resolveFfprobeBin(config), ['-v', 'quiet', '-print_format', 'json', '-show_format', sourcePath]);
  if (r.code !== 0) return 0;
  try {
    const j = JSON.parse(r.out || '{}');
    return Number(j.format && j.format.duration || 0) || 0;
  } catch (_) {
    return 0;
  }
}

async function extractFrames({ config, western, sourcePath, taskId }) {
  const root = path.join(configStoreDataRoot(), 'western-ai-frames', safeId(taskId));
  await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(root, { recursive: true });
  const duration = await ffprobeDuration(config, sourcePath);
  const count = Math.max(1, Math.min(Number(western.frameSampleCount) || 36, 80));
  const width = Math.max(224, Math.min(Number(western.frameWidth) || 640, 1920));
  const timestamps = [];
  if (duration > 2) {
    const usable = Math.max(1, duration - 2);
    for (let i = 0; i < count; i++) timestamps.push(Number((1 + usable * (i + 0.5) / count).toFixed(2)));
  } else {
    timestamps.push(0);
  }
  const frames = [];
  const ffmpeg = transcodeService.resolveFfmpegBin(config);
  for (let i = 0; i < timestamps.length; i++) {
    const out = path.join(root, `frame-${String(i).padStart(3, '0')}.jpg`);
    const r = await runCmd(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(timestamps[i]),
      '-i', sourcePath,
      '-frames:v', '1',
      '-vf', `scale='min(${width},iw)':-2`,
      out,
    ]);
    if (r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) frames.push(out);
  }
  return frames;
}

function configStoreDataRoot() {
  const configStore = require('../configStore');
  return configStore.resolveDataDir();
}

function normalizeVector(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => Number(x)).filter((x) => Number.isFinite(x));
}

function cosineSimilarity(a, b) {
  a = normalizeVector(a);
  b = normalizeVector(b);
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function meanVector(vectors) {
  if (!vectors.length) return [];
  const len = vectors[0].length;
  const sum = new Array(len).fill(0);
  for (const v of vectors) for (let i = 0; i < len; i++) sum[i] += v[i] || 0;
  const mean = sum.map((x) => x / vectors.length);
  const norm = Math.sqrt(mean.reduce((a, b) => a + b * b, 0));
  return norm > 0 ? mean.map((x) => x / norm) : mean;
}

async function callFaceEmbeddingModel(western, images, options = {}) {
  const url = String(process.env.FACE_EMBEDDINGS_URL || INTERNAL_FACE_EMBEDDINGS_URL).trim();
  const workerPath = path.join(__dirname, 'faceEmbeddingWorker.js');
  const timeoutMs = Math.max(10, Number(western.faceTimeoutSec) || 120) * 1000 + 5000;
  const imageRefs = images.map((frame) => (Buffer.isBuffer(frame) ? { buffer: frame } : { path: frame }));
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerPath, {
      workerData: {
        url,
        western: { faceTimeoutSec: western.faceTimeoutSec },
        images: imageRefs,
        options: {
          blacklist: Array.isArray(options.blacklist) ? options.blacklist : [],
          blacklistThreshold: options.blacklistThreshold,
        },
        faceApiKey: process.env.FACE_API_KEY || '',
      },
    });
    const finish = (err, faces) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(faces);
    };
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {});
      finish(new Error('Face embedding worker timed out'));
    }, timeoutMs);
    worker.once('message', (msg) => {
      if (msg && msg.ok) finish(null, Array.isArray(msg.faces) ? msg.faces : []);
      else finish(new Error(msg && msg.error || 'Face embedding worker failed'));
    });
    worker.once('error', (err) => finish(err));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(new Error(`Face embedding worker exited with code ${code}`));
    });
  });
}

function clusterFaces(faces, clusterThreshold = 0.5) {
  const clusters = [];
  for (const face of faces) {
    let matched = null;
    let bestScore = clusterThreshold;
    for (const c of clusters) {
      const score = cosineSimilarity(face.embedding, c.embedding);
      if (score >= bestScore) { bestScore = score; matched = c; }
    }
    if (matched) {
      matched.members.push(face);
      matched.sumArea += face.faceArea || 0;
      if ((face.faceArea || 0) > (matched.bestFace.faceArea || 0)) matched.bestFace = face;
    } else {
      clusters.push({
        clusterId: `cluster-${clusters.length + 1}`,
        embedding: face.embedding,
        members: [face],
        sumArea: face.faceArea || 0,
        bestFace: face,
      });
    }
  }
  return clusters.map((c) => ({
    clusterId: c.clusterId,
    embedding: meanVector(c.members.map((m) => m.embedding).filter((e) => e.length)),
    frameCount: c.members.length,
    avgFaceArea: c.members.length ? Math.round(c.sumArea / c.members.length) : 0,
    bestFrameIndex: c.bestFace.imageIndex,
    sampleImageBase64: c.bestFace.sampleImageBase64 || '',
    bbox: c.bestFace.bbox || null,
    detectionScore: c.bestFace.detectionScore || 0,
  }));
}

function bestReferenceFaceMatch(face, people, threshold) {
  let best = null;
  for (const person of Array.isArray(people) ? people : []) {
    for (const ref of Array.isArray(person.referenceFaces) ? person.referenceFaces : []) {
      const score = cosineSimilarity(face.embedding, ref.embedding || ref.vector);
      if (!best || score > best.confidence) {
        best = {
          personId: person.personId || '',
          name: person.name || '',
          confidence: score,
          matchMode: 'face_embedding',
          referenceFaceId: ref.faceId || ref.clusterId || '',
        };
      }
    }
  }
  return best && best.confidence >= threshold ? best : null;
}

function addActor(match, personMatch) {
  if (!personMatch || !personMatch.name) return;
  if (!match.actors.includes(personMatch.name)) match.actors.push(personMatch.name);
  match.actorConfidence[personMatch.name] = Math.max(match.actorConfidence[personMatch.name] || 0, Number(personMatch.confidence) || 0);
  if (!match.matchedPeople.some((p) => p.personId === personMatch.personId && p.name === personMatch.name && p.matchMode === personMatch.matchMode)) {
    match.matchedPeople.push(personMatch);
  }
}

function matchPeople(people, clusters, threshold) {
  const match = { actors: [], actorConfidence: {}, matchedPeople: [], faceClusters: [], unknownFaces: [] };
  for (const face of clusters) {
    const personMatch = bestReferenceFaceMatch(face, people, threshold);
    if (personMatch) {
      addActor(match, personMatch);
      match.faceClusters.push({
        clusterId: face.clusterId,
        matchedPersonId: personMatch.personId,
        matchedName: personMatch.name,
        confidence: personMatch.confidence,
        matchMode: personMatch.matchMode,
        referenceFaceId: personMatch.referenceFaceId || '',
      });
    }
  }
  return match;
}

function decodeImagePayload(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const m = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  try {
    const buf = Buffer.from(m ? m[1] : raw, 'base64');
    return buf.length ? buf : null;
  } catch (_) {
    return null;
  }
}

async function referenceImageForPerson(people, personId, referenceFaceId) {
  const person = (Array.isArray(people) ? people : []).find((p) => String(p.personId || '') === String(personId || ''));
  if (!person) return null;
  const refs = Array.isArray(person.referenceFaces) ? person.referenceFaces : [];
  const preferred = refs.find((ref) => String(ref.faceId || ref.clusterId || '') === String(referenceFaceId || ''));
  const ref = preferred || refs[0];
  if (!ref) return null;
  const embedded = decodeImagePayload(ref.sampleImageBase64 || ref.cropImageBase64 || ref.imageBase64);
  if (embedded) return embedded;
  const file = String(ref.sampleImage || '').trim();
  if (file && fs.existsSync(file)) return fsp.readFile(file);
  return null;
}

function xmlEscape(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function wrapText(value, maxChars, maxLines) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; } else { line = next; }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

async function buildCompositePoster({ actorName, sceneTitle, referenceImage, galleryImages }) {
  const sharp = loadSharp();
  if (!sharp || !referenceImage) return '';
  const width = 1000; const height = 1500; const mainHeight = 1040;
  const background = await sharp(referenceImage).rotate().resize(width, mainHeight, { fit: 'cover', position: 'attention' }).blur(18).modulate({ brightness: 0.72, saturation: 0.85 }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const portrait = await sharp(referenceImage).rotate().resize(width, mainHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const composites = [{ input: background, left: 0, top: 0 }, { input: portrait, left: 0, top: 0 }];
  const thumbW = 218; const thumbH = 150; const gap = 18; const thumbX0 = Math.round((width - (thumbW * 4 + gap * 3)) / 2);
  for (let i = 0; i < Math.min(4, galleryImages.length); i++) {
    const buf = decodeImagePayload(galleryImages[i].imageBase64);
    if (!buf) continue;
    const img = await sharp(buf).rotate().resize(thumbW - 6, thumbH - 6, { fit: 'cover', position: 'attention' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    const thumb = await sharp({ create: { width: thumbW, height: thumbH, channels: 4, background: { r: 245, g: 245, b: 239, alpha: 1 } } }).composite([{ input: img, left: 3, top: 3 }]).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    composites.push({ input: thumb, left: thumbX0 + i * (thumbW + gap), top: 1022 });
  }
  const titleLines = wrapText(sceneTitle, 34, 2).map((line, i) => `<text x="64" y="${1312 + i * 48}" font-size="42" fill="#f5f1e8">${xmlEscape(line)}</text>`).join('');
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.62" stop-color="#000" stop-opacity="0.42"/><stop offset="1" stop-color="#000" stop-opacity="0.88"/></linearGradient></defs><rect x="0" y="760" width="${width}" height="740" fill="url(#fade)"/><rect x="0" y="1186" width="${width}" height="314" fill="#141414" fill-opacity="0.92"/><rect x="64" y="1238" width="94" height="5" fill="#d7b46a"/><text x="64" y="1222" font-family="Arial, Helvetica, sans-serif" font-size="84" font-weight="700" fill="#fff">${xmlEscape(actorName)}</text><g font-family="Arial, Helvetica, sans-serif" font-weight="400">${titleLines}</g></svg>`);
  composites.push({ input: overlay, left: 0, top: 0 });
  return (await sharp({ create: { width, height, channels: 3, background: '#111' } }).composite(composites).jpeg({ quality: 90, mozjpeg: true }).toBuffer()).toString('base64');
}

function titleWordsFromFilename(filename) {
  return safeName(path.basename(String(filename || ''), path.extname(String(filename || ''))).replace(/[._]+/g, ' ').replace(/\s+-\s+/g, ' - '), 'Scene');
}

async function analyzeVideo({ taskId, config, subLib, item, western, onLog }) {
  if (!item.path || !fs.existsSync(item.path)) throw new Error(`Media file does not exist: ${item.path || ''}`);
  onLog && onLog('info', 'Running western adult analysis locally in service');
  const frames = await extractFrames({ config, western, sourcePath: item.path, taskId });
  if (!frames.length) throw new Error('No frames extracted from source asset');
  const rawFaces = western.faceRecognitionEnabled === false ? [] : await callFaceEmbeddingModel(western, frames, {
    blacklist: peopleStore.listDismissedEmbeddings({ adultRegion: 'western_adult' }),
    blacklistThreshold: Number(western.blacklistThreshold) || 0.5,
  });
  const clusters = clusterFaces(rawFaces, Number(western.faceClusterThreshold) || 0.5);
  const people = peopleStore.listPeople({ adultRegion: 'western_adult', includeArtifacts: true, limit: 200 }).people;
  const match = matchPeople(people, clusters, Number(western.faceSimilarityThreshold) || 0.25);
  const clustersWithMatch = clusters.map((c) => {
    const fc = match.faceClusters.find((x) => x.clusterId === c.clusterId);
    return {
      ...c,
      protagonistScore: Math.round((c.avgFaceArea || 0) * c.frameCount),
      matchedPersonId: fc && fc.matchedPersonId || '',
      matchedName: fc && fc.matchedName || '',
      matchConfidence: fc && fc.confidence || 0,
      referenceFaceId: fc && fc.referenceFaceId || '',
      status: fc ? 'named' : 'unknown',
    };
  }).sort((a, b) => b.protagonistScore - a.protagonistScore);
  const protagonist = clustersWithMatch.find((c) => c.status === 'named') || null;
  const actorLabel = protagonist ? protagonist.matchedName : (match.actors[0] || 'Unknown Person');
  const description = titleWordsFromFilename(item.path);
  const galleryImages = [];
  for (const [i, frame] of frames.slice(0, 6).entries()) {
    galleryImages.push({ frameIndex: i, imageBase64: (await fsp.readFile(frame)).toString('base64') });
    if ((i + 1) % 2 === 0) await yieldToEventLoop();
  }
  const referenceImage = protagonist ? await referenceImageForPerson(people, protagonist.matchedPersonId, protagonist.referenceFaceId) : null;
  const posterImageBase64 = await buildCompositePoster({ actorName: actorLabel, sceneTitle: description, referenceImage, galleryImages })
    || (frames[0] ? (await fsp.readFile(frames[0])).toString('base64') : '');
  return {
    title: safeName(`${actorLabel} - ${description}`),
    generatedTitle: safeName(`${actorLabel} - ${description}`),
    generatedDescription: description,
    actors: match.actors,
    actorConfidence: match.actorConfidence,
    matchedPeople: match.matchedPeople,
    protagonist: protagonist ? {
      clusterId: protagonist.clusterId,
      personId: protagonist.matchedPersonId,
      name: protagonist.matchedName,
      confidence: protagonist.matchConfidence,
      protagonistScore: protagonist.protagonistScore,
    } : null,
    tags: ['western_adult'],
    genres: ['Adult'],
    scene: { setting: '', style: '', performerCount: clustersWithMatch.length, summary: description, visionUsable: false },
    faceClusters: clustersWithMatch,
    unknownFaces: clustersWithMatch.filter((c) => c.status === 'unknown'),
    posterImageBase64,
    galleryImages,
    needsReview: !protagonist,
    ai: {
      worker: 'media-service',
      provider: 'service-local',
      matchMode: match.faceClusters.length ? 'face_embedding' : 'none',
      faceEmbeddingsEnabled: western.faceRecognitionEnabled !== false,
      faceEmbeddingsMode: 'internal',
      posterMode: referenceImage ? 'composite' : 'keyframe',
      frameCount: frames.length,
      clusterCount: clusters.length,
      faceCount: rawFaces.length,
      computeMode: 'local',
    },
  };
}

async function createReferenceFace({ western, imageBase64, referenceId }) {
  const image = decodeImagePayload(imageBase64);
  if (!image) throw new Error('imageBase64 is required');
  const faces = await callFaceEmbeddingModel(western, [image], {});
  if (!faces.length) throw new Error('No face detected in reference image');
  const face = [...faces].sort((a, b) => (b.faceArea || 0) - (a.faceArea || 0))[0];
  return {
    faceId: referenceId || crypto.randomUUID(),
    embedding: face.embedding || [],
    bbox: face.bbox || null,
    detectionScore: face.detectionScore || face.confidence || 0,
    faceCount: faces.length,
    sampleImageBase64: face.sampleImageBase64 || '',
  };
}

module.exports = { analyzeVideo, createReferenceFace, INTERNAL_FACE_EMBEDDINGS_URL };
