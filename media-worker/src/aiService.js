'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

const assets = new Map();
const aiJobs = new Map();
let aiBusy = false;
let sharpModule;

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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stateFile(cfg, name) {
  return path.join(cfg.aiDataRoot, `${name}.json`);
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function saveJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function init(cfg) {
  ensureDir(cfg.aiDataRoot);
  ensureDir(path.join(cfg.aiDataRoot, 'assets'));
  ensureDir(path.join(cfg.aiDataRoot, 'frames'));
  const persisted = loadJson(stateFile(cfg, 'assets'), { assets: [] });
  assets.clear();
  for (const row of persisted.assets || []) {
    if (row && row.assetId) assets.set(row.assetId, row);
  }
}

function persistAssets(cfg) {
  saveJson(stateFile(cfg, 'assets'), { assets: [...assets.values()] });
}

function imageBufferFromBase64(value) {
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

function assetDir(cfg, assetId) {
  return path.join(cfg.aiDataRoot, 'assets', safeId(assetId));
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

async function ffprobeDuration(ffprobeBin, sourcePath) {
  const r = await runCmd(ffprobeBin, ['-v', 'quiet', '-print_format', 'json', '-show_format', sourcePath]);
  if (r.code !== 0) return 0;
  try {
    const j = JSON.parse(r.out || '{}');
    return Number(j.format && j.format.duration || 0) || 0;
  } catch (_) {
    return 0;
  }
}

async function extractFrames({ cfg, ffmpegBin, ffprobeBin, asset, jobId, count, width }) {
  const outDir = path.join(cfg.aiDataRoot, 'frames', safeId(jobId));
  await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
  ensureDir(outDir);

  const duration = await ffprobeDuration(ffprobeBin, asset.localPath);
  const targetCount = Math.max(1, Math.min(Number(count) || 36, 80));
  const maxW = Math.max(224, Math.min(Number(width) || 640, 1920));
  const scaleFilter = `scale='min(${maxW},iw)':-2`;

  // Scene-change-aware sampling: detect shot boundaries and keep one frame per
  // scene, so VLM/face recognition see representative frames across the whole
  // video instead of only the first few seconds. Falls back to uniform sampling
  // when the video is too short or scene detection yields too little.
  let timestamps = [];
  if (duration > 4) {
    const sceneThresh = Number(cfg.sceneDetectThreshold) || 0.3;
    // ffmpeg scene detect via showinfo would require parsing stderr; instead use
    // the select filter with fps throttling to cap candidate frames, then pick
    // scene-change frames. Use a single pass that emits a frame on each scene
    // change, capped by targetCount.
    const detected = await detectSceneTimestamps(ffmpegBin, asset.localPath, duration, sceneThresh, targetCount);
    if (detected.length >= Math.min(4, targetCount)) {
      timestamps = detected;
    }
  }

  if (timestamps.length === 0) {
    // Uniform fallback.
    if (duration > 2) {
      const usable = Math.max(1, duration - 2);
      for (let i = 0; i < targetCount; i++) timestamps.push(Number((1 + usable * (i + 0.5) / targetCount).toFixed(2)));
    } else {
      timestamps.push(0);
    }
  }

  const frames = [];
  for (let i = 0; i < timestamps.length; i++) {
    const out = path.join(outDir, `frame-${String(i).padStart(3, '0')}.jpg`);
    const r = await runCmd(ffmpegBin, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(timestamps[i]),
      '-i', asset.localPath,
      '-frames:v', '1',
      '-vf', scaleFilter,
      out,
    ]);
    if (r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) frames.push(out);
  }
  return frames;
}

// Probe scene-change timestamps via ffmpeg's select filter + showinfo. Returns a
// capped list of timestamps (seconds) at which a new scene begins.
async function detectSceneTimestamps(ffmpegBin, sourcePath, duration, threshold, maxCount) {
  const sampleFps = 2; // sample 2 frames/sec for detection — cheap, sufficient
  const r = await runCmd(ffmpegBin, [
    '-hide_banner', '-nostats',
    '-i', sourcePath,
    '-vf', `fps=${sampleFps},select='gt(scene,${threshold})',showinfo`,
    '-f', 'null', '-',
  ], { timeout: 10 * 60 * 1000 });
  const out = `${r.out}\n${r.err}`;
  const times = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/pts_time:([0-9.]+)/);
    if (m) {
      const t = Number(m[1]);
      if (Number.isFinite(t) && t >= 0 && t <= duration) times.push(Number(t.toFixed(2)));
    }
  }
  // Always include ~10% evenly spaced anchors so we never get zero frames from a
  // flat (low-scene-change) video, and so VLM still sees the full timeline.
  const anchors = Math.max(2, Math.floor(maxCount * 0.1));
  for (let i = 0; i < anchors; i++) {
    times.push(Number((duration * (i + 0.5) / anchors).toFixed(2)));
  }
  // De-dup + sort + cap.
  const uniq = [...new Set(times)].sort((a, b) => a - b);
  if (uniq.length <= maxCount) return uniq;
  // Evenly stride to the cap.
  const stride = uniq.length / maxCount;
  const out2 = [];
  for (let i = 0; i < maxCount; i++) out2.push(uniq[Math.floor(i * stride)]);
  return out2;
}

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasesForPerson(person) {
  return [person.name, ...(person.aliases || [])]
    .map(normalizeForMatch)
    .filter(Boolean);
}

function normalizeVector(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => Number(x)).filter((x) => Number.isFinite(x));
}

function cosineSimilarity(a, b) {
  a = normalizeVector(a);
  b = normalizeVector(b);
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = require('sharp');
  } catch (_) {
    sharpModule = null;
  }
  return sharpModule;
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeImagePayload(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const m = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const body = m ? m[1] : raw;
  try {
    const buf = Buffer.from(body, 'base64');
    return buf.length ? buf : null;
  } catch (_) {
    return null;
  }
}

function readReferenceImage(ref) {
  if (!ref) return null;
  const embedded = decodeImagePayload(ref.sampleImageBase64 || ref.cropImageBase64 || ref.imageBase64);
  if (embedded) return embedded;
  const file = String(ref.sampleImage || ref.imagePath || '').trim();
  if (!file || !fs.existsSync(file)) return null;
  try { return fs.readFileSync(file); } catch (_) { return null; }
}

function referenceImageForPerson(people, personId, referenceFaceId) {
  const person = (Array.isArray(people) ? people : []).find((p) => String(p.personId || '') === String(personId || ''));
  if (!person) return null;
  const refs = Array.isArray(person.referenceFaces) ? person.referenceFaces : [];
  const preferred = refs.find((ref) => String(ref.faceId || ref.clusterId || '') === String(referenceFaceId || ''));
  return readReferenceImage(preferred) || refs.map(readReferenceImage).find(Boolean) || null;
}

function wrapText(value, maxChars, maxLines) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[. ]+$/, '')}...`;
  }
  return lines;
}

async function imageToCoverBuffer(sharp, input, width, height, opts = {}) {
  return sharp(input)
    .rotate()
    .resize(width, height, {
      fit: 'cover',
      position: opts.position || 'attention',
    })
    .jpeg({ quality: opts.quality || 88, mozjpeg: true })
    .toBuffer();
}

async function imageToContainBuffer(sharp, input, width, height) {
  return sharp(input)
    .rotate()
    .resize(width, height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function buildWesternCompositePoster({ actorName, sceneTitle, referenceImage, galleryImages }) {
  const sharp = loadSharp();
  if (!sharp || !referenceImage) return { base64: '', mode: 'keyframe', error: sharp ? '' : 'sharp module is not installed' };

  const width = 1000;
  const height = 1500;
  const mainHeight = 1040;
  const thumbY = 1022;
  const thumbW = 218;
  const thumbH = 150;
  const gap = 18;
  const thumbX0 = Math.round((width - (thumbW * 4 + gap * 3)) / 2);
  const titleLines = wrapText(sceneTitle, 34, 2);

  try {
    const mainBackground = await sharp(referenceImage)
      .rotate()
      .resize(width, mainHeight, { fit: 'cover', position: 'attention' })
      .blur(18)
      .modulate({ brightness: 0.72, saturation: 0.85 })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const mainPortrait = await imageToContainBuffer(sharp, referenceImage, width, mainHeight);
    const composites = [
      { input: mainBackground, left: 0, top: 0 },
      { input: mainPortrait, left: 0, top: 0 },
    ];

    const gallery = (Array.isArray(galleryImages) ? galleryImages : [])
      .map((g) => decodeImagePayload(g && (g.imageBase64 || g.base64 || g.data)))
      .filter(Boolean)
      .slice(0, 4);

    for (let i = 0; i < gallery.length; i++) {
      const thumbImage = await imageToCoverBuffer(sharp, gallery[i], thumbW - 6, thumbH - 6, { quality: 82 });
      const thumb = await sharp({
        create: {
          width: thumbW,
          height: thumbH,
          channels: 4,
          background: { r: 245, g: 245, b: 239, alpha: 1 },
        },
      })
        .composite([{ input: thumbImage, left: 3, top: 3 }])
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      composites.push({ input: thumb, left: thumbX0 + i * (thumbW + gap), top: thumbY });
    }

    const titleText = titleLines.map((line, i) =>
      `<text x="64" y="${1312 + i * 48}" font-size="42" fill="#f5f1e8">${xmlEscape(line)}</text>`
    ).join('');
    const overlay = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#000000" stop-opacity="0"/>
            <stop offset="0.62" stop-color="#000000" stop-opacity="0.42"/>
            <stop offset="1" stop-color="#000000" stop-opacity="0.88"/>
          </linearGradient>
        </defs>
        <rect x="0" y="760" width="${width}" height="740" fill="url(#fade)"/>
        <rect x="0" y="1186" width="${width}" height="314" fill="#141414" fill-opacity="0.92"/>
        <rect x="64" y="1238" width="94" height="5" fill="#d7b46a"/>
        <text x="64" y="1222" font-family="Arial, Helvetica, sans-serif" font-size="84" font-weight="700" fill="#ffffff">${xmlEscape(actorName)}</text>
        <g font-family="Arial, Helvetica, sans-serif" font-weight="400">${titleText}</g>
      </svg>
    `);
    composites.push({ input: overlay, left: 0, top: 0 });

    const out = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: '#111111',
      },
    })
      .composite(composites)
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return { base64: out.toString('base64'), mode: 'composite', error: '' };
  } catch (e) {
    return { base64: '', mode: 'keyframe', error: e.message };
  }
}

function bestReferenceFaceMatch(face, people, threshold) {
  const embedding = normalizeVector(face.embedding || face.vector);
  if (!embedding.length) return null;
  let best = null;
  for (const person of Array.isArray(people) ? people : []) {
    for (const ref of Array.isArray(person.referenceFaces) ? person.referenceFaces : []) {
      const score = cosineSimilarity(embedding, ref.embedding || ref.vector);
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
  match.actorConfidence[personMatch.name] = Math.max(
    match.actorConfidence[personMatch.name] || 0,
    Number(personMatch.confidence) || 0,
  );
  if (!match.matchedPeople.some((p) => p.personId === personMatch.personId && p.name === personMatch.name && p.matchMode === personMatch.matchMode)) {
    match.matchedPeople.push(personMatch);
  }
}

function matchPeopleByAlias(people, text, base = null) {
  people = Array.isArray(people) ? people : [];
  const haystack = normalizeForMatch(text);
  const match = base || { actors: [], actorConfidence: {}, matchedPeople: [] };
  for (const person of people) {
    for (const alias of aliasesForPerson(person)) {
      if (!alias) continue;
      if (haystack.includes(alias)) {
        addActor(match, {
          personId: person.personId || '',
          name: person.name,
          confidence: 0.99,
          matchMode: 'alias',
        });
        break;
      }
    }
  }
  return match;
}

function matchPeople({ people, text, faces, threshold }) {
  const match = { actors: [], actorConfidence: {}, matchedPeople: [], faceClusters: [], unknownFaces: [] };
  for (const face of Array.isArray(faces) ? faces : []) {
    const personMatch = bestReferenceFaceMatch(face, people, threshold);
    const clusterId = String(face.clusterId || face.faceId || `face-${match.faceClusters.length + match.unknownFaces.length + 1}`);
    if (personMatch) {
      addActor(match, personMatch);
      match.faceClusters.push({
        clusterId,
        faceId: face.faceId || '',
        matchedPersonId: personMatch.personId,
        matchedName: personMatch.name,
        confidence: personMatch.confidence,
        matchMode: personMatch.matchMode,
        referenceFaceId: personMatch.referenceFaceId || '',
      });
    } else {
      match.unknownFaces.push({
        clusterId,
        faceId: face.faceId || '',
        bbox: face.bbox || face.box || null,
        confidence: Number(face.confidence) || 0,
        embedding: normalizeVector(face.embedding || face.vector),
        sampleImageBase64: face.sampleImageBase64 || face.cropImageBase64 || '',
      });
    }
  }
  matchPeopleByAlias(people, text, match);
  return match;
}

function titleWordsFromFilename(filename) {
  const stem = path.basename(String(filename || ''), path.extname(String(filename || '')));
  return safeName(stem.replace(/[._]+/g, ' ').replace(/\s+-\s+/g, ' - '), 'Scene');
}

function buildDescription(asset, actors) {
  const cleaned = titleWordsFromFilename(asset.sourceFileName);
  let desc = cleaned;
  for (const actor of actors) {
    const re = new RegExp(actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    desc = desc.replace(re, '').replace(/\s+/g, ' ').trim(' -.');
  }
  return safeName(desc || cleaned, 'Scene');
}

function parseJsonContent(content) {
  if (!content) return null;
  if (typeof content === 'object') return content;
  const text = String(content).trim();
  try { return JSON.parse(text); } catch (_) {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) {}
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

function cleanVisionSummary(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/^(the\s+)?image\s+(you['’]?ve\s+provided\s+)?(appears to be|shows|depicts|is)\s+/i, '')
    .replace(/^this image\s+(appears to be|shows|depicts|is)\s+/i, '')
    .replace(/^it\s+(appears to be|shows|depicts|is)\s+/i, '')
    .trim();
}

function normalizeVisionResult(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    summary: safeName(cleanVisionSummary(v.summary || v.safeSummary || v.description || ''), ''),
    tags: Array.isArray(v.tags) ? v.tags.map((x) => safeName(x, '')).filter(Boolean).slice(0, 20) : [],
    setting: safeName(v.setting || '', ''),
    style: safeName(v.style || '', ''),
    performerCount: Number.isFinite(Number(v.performerCount)) ? Number(v.performerCount) : 0,
    titleCandidates: Array.isArray(v.titleCandidates)
      ? v.titleCandidates.map((x) => safeName(cleanVisionSummary(x), '')).filter(Boolean).slice(0, 5)
      : [],
  };
}

function isGenericDescription(value) {
  const text = String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!text) return true;
  if (text.includes('image you ve provided') || text.includes('provided image')) return true;
  if (text.includes('not a real scene') || text.includes('composite of two separate photos')) return true;
  return ['scene', 'adult scene', 'video scene', 'media scene', 'unknown scene'].includes(text);
}

function sentenceCandidates(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeFreeformVisionResult(content) {
  const blocked = [
    /not suitable/i,
    /important to handle/i,
    /cannot assist/i,
    /can't assist/i,
    /i'?m sorry/i,
  ];
  for (let sentence of sentenceCandidates(content)) {
    if (blocked.some((re) => re.test(sentence))) continue;
    sentence = cleanVisionSummary(sentence).replace(/^a screenshot from a video,?\s*/i, '').trim();
    if (!sentence || isGenericDescription(sentence)) continue;
    return normalizeVisionResult({ summary: safeName(sentence, ''), titleCandidates: [sentence] });
  }
  return null;
}

async function callFaceEmbeddingModel(cfg, frames, options = {}) {
  if (!cfg.faceEmbeddingsUrl || frames.length === 0) return { faces: [], error: '' };
  // Send every sampled frame — clustering across frames (not per-frame identity)
  // is what lets the service decide a protagonist by frequency + face size.
  const images = frames.map((frame, index) => ({
    imageId: `frame-${String(index).padStart(3, '0')}`,
    imageIndex: index,
    data: fs.readFileSync(frame).toString('base64'),
    mimeType: 'image/jpeg',
  }));
  const body = { images, detect: true, returnCrops: true };
  if (Array.isArray(options.blacklist) && options.blacklist.length) {
    body.blacklist = options.blacklist;
    body.blacklistThreshold = Number(options.blacklistThreshold) || 0.5;
  }
  const headers = { 'content-type': 'application/json' };
  if (cfg.faceApiKey) headers.authorization = `Bearer ${cfg.faceApiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5, Number(cfg.faceTimeoutSec) || 120) * 1000);
  try {
    const res = await fetch(cfg.faceEmbeddingsUrl, {
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
        imageId: face.imageId || '',
        imageIndex: Number.isFinite(Number(face.imageIndex)) ? Number(face.imageIndex) : 0,
        bbox,
        faceArea: area,
        detectionScore: Number(face.detectionScore) || 0,
        confidence: Number(face.confidence) || Number(face.detectionScore) || 0,
        embedding: normalizeVector(face.embedding || face.vector),
        sampleImageBase64: face.sampleImageBase64 || face.cropImageBase64 || (images[Number(face.imageIndex) || 0] && images[Number(face.imageIndex) || 0].data) || '',
      };
    }).filter((face) => face.embedding.length > 0);
    return { faces, error: '' };
  } catch (e) {
    return { faces: [], error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Cluster raw per-frame face detections into identity groups. Same person across
// many frames collapses to one cluster with aggregated stats (frameCount,
// avgFaceArea) used by the service to pick a protagonist, plus the single best
// (largest-face) representative crop for display/reference.
function clusterFaces(faces, clusterThreshold = 0.5) {
  const clusters = [];
  for (const face of faces) {
    const emb = face.embedding || [];
    let matched = null;
    let bestScore = clusterThreshold;
    for (const c of clusters) {
      const score = cosineSimilarity(emb, c.embedding);
      if (score >= bestScore) { bestScore = score; matched = c; }
    }
    if (matched) {
      matched.members.push(face);
      // Running average of face area and embedding (mean of member embeddings,
      // re-normalized, for subsequent matching).
      matched.sumArea += face.faceArea || 0;
      if ((face.faceArea || 0) > (matched.bestFace.faceArea || 0)) {
        matched.bestFace = face;
      }
    } else {
      clusters.push({
        clusterId: `cluster-${clusters.length + 1}`,
        embedding: emb,
        members: [face],
        sumArea: face.faceArea || 0,
        bestFace: face,
      });
    }
  }
  // Re-derive a stable centroid embedding and stats per cluster.
  return clusters.map((c) => {
    const embs = c.members.map((m) => m.embedding).filter((e) => e.length);
    const centroid = meanVector(embs);
    const frameCount = c.members.length;
    const avgFaceArea = frameCount ? Math.round(c.sumArea / frameCount) : 0;
    return {
      clusterId: c.clusterId,
      embedding: centroid,
      frameCount,
      avgFaceArea,
      bestFaceIndex: c.bestFace.imageIndex,
      sampleImageBase64: c.bestFace.sampleImageBase64 || '',
      bbox: c.bestFace.bbox || null,
      detectionScore: c.bestFace.detectionScore || 0,
    };
  });
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

// Pick up to 6 representative frames for the gallery: prefer one frame per
// distinct face cluster (its best frame), then fill from evenly-spaced frames
// so the wall spans the whole timeline.
function pickGalleryFrames(frames, clusters, rawFaces) {
  const want = Math.min(6, frames.length);
  const chosen = new Set();
  for (const c of clusters) {
    if (c.bestFrameIndex != null && chosen.size < want) chosen.add(c.bestFrameIndex);
  }
  if (chosen.size < want) {
    const step = Math.max(1, Math.floor(frames.length / (want - chosen.size || 1)));
    for (let i = 0; i < frames.length && chosen.size < want; i += step) chosen.add(i);
  }
  return [...chosen].sort((a, b) => a - b).slice(0, want);
}

async function callVisionModel(cfg, frames, asset, actors, options = {}) {
  if (!options.vlmEnabled || !cfg.visionBaseUrl || !cfg.visionModel || frames.length === 0) return null;
  // Prefer frames with the largest detected faces (passed in via options.frameScores)
  // so the VLM describes people/content, not opening logos or dark establishing shots.
  let selected = frames;
  const scores = options.frameScores;
  if (Array.isArray(scores) && scores.length === frames.length) {
    const order = frames.map((f, i) => ({ f, s: scores[i] || 0 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, Math.min(8, frames.length));
    selected = order.map((o) => o.f);
  } else {
    selected = frames.slice(0, 8);
  }
  const images = [];
  for (const frame of selected) {
    images.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(frame).toString('base64')}` },
    });
  }
  const body = {
    model: cfg.visionModel,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'Return compact JSON only for media-library metadata. Do not include markdown.',
            'Keys: summary, tags, setting, style, performerCount, titleCandidates.',
            'The summary must be one specific sentence, not a generic label like Scene.',
            'If JSON is difficult, return one concise catalog summary sentence instead.',
            options.allowExplicitGeneratedText
              ? 'Use direct adult metadata wording when visually supported, but keep it concise.'
              : 'Keep wording non-graphic and suitable for a media library.',
            `Known actors: ${actors.join(', ') || 'unknown'}.`,
            `Filename: ${asset.sourceFileName}.`,
          ].join(' '),
        },
        ...images,
      ],
    }],
    temperature: 0.2,
    max_tokens: Number(cfg.visionMaxTokens) || 512,
  };
  const headers = { 'content-type': 'application/json' };
  if (cfg.visionApiKey) headers.authorization = `Bearer ${cfg.visionApiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5, Number(cfg.visionTimeoutSec) || 180) * 1000);
  try {
    const res = await fetch(`${String(cfg.visionBaseUrl).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error && json.error.message || `HTTP ${res.status}`);
    const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    const parsed = normalizeVisionResult(parseJsonContent(content));
    if (!isGenericDescription(parsed.summary)) return parsed;
    return normalizeFreeformVisionResult(content) || parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function runAiJob(jobId, helpers) {
  const job = aiJobs.get(jobId);
  if (!job || job.status !== 'queued') return;
  if (aiBusy) {
    setTimeout(() => runAiJob(jobId, helpers).catch(() => {}), 1000).unref();
    return;
  }
  aiBusy = true;
  job.status = 'executing';
  job.progress = 5;
  try {
    const cfg = helpers.config.loadConfig();
    const asset = assets.get(job.assetId);
    if (!asset || asset.status !== 'ready' || !fs.existsSync(asset.localPath)) {
      throw new Error('Source asset is not ready');
    }
    asset.lastUsedAt = new Date().toISOString();
    persistAssets(cfg);

    const frames = await extractFrames({
      cfg,
      ffmpegBin: helpers.resolveFfmpegBin(cfg),
      ffprobeBin: helpers.resolveFfprobeBin(cfg),
      asset,
      jobId,
      count: job.options.frameSampleCount,
      width: job.options.frameWidth,
    });
    job.progress = 45;
    if (frames.length === 0) throw new Error('No frames extracted from source asset');

    const faceResult = job.options.faceRecognitionEnabled
      ? await callFaceEmbeddingModel(cfg, frames, {
          blacklist: job.options.blacklist || [],
          blacklistThreshold: job.options.blacklistThreshold,
        })
      : { faces: [], error: '' };

    // Cross-frame clustering: collapse per-frame detections into identity groups
    // with frequency + face-size stats. Matching then runs on cluster centroids,
    // and the service uses frameCount/avgFaceArea to pick a protagonist.
    const clusterThreshold = Number(cfg.faceClusterThreshold) || 0.5;
    const clusters = faceResult.faces.length
      ? clusterFaces(faceResult.faces, clusterThreshold)
      : [];
    const match = matchPeople({
      people: job.people,
      text: `${asset.sourceFileName} ${job.itemName || ''}`,
      faces: clusters, // clusters carry .embedding like raw faces did
      threshold: Number(job.options.faceSimilarityThreshold) || Number(cfg.faceSimilarityThreshold) || 0.25,
    });

    // Score every frame by the largest face it contains, so the VLM is fed
    // content-rich frames and the poster is the clearest protagonist shot.
    const frameScores = frames.map((_, i) => {
      let best = 0;
      for (const c of clusters) {
        if (c.bestFaceIndex === i) best = Math.max(best, c.avgFaceArea || 0);
      }
      // Also credit frames where any raw detection of a cluster member landed.
      for (const f of faceResult.faces) {
        if (f.imageIndex === i) best = Math.max(best, f.faceArea || 0);
      }
      return best;
    });

    const vision = await callVisionModel(cfg, frames, asset, match.actors, {
        ...job.options,
        frameScores,
      })
      .catch((e) => ({ error: e.message }));
    job.progress = 80;

    const visionSummary = vision && !isGenericDescription(vision.summary) ? vision.summary : '';
    const candidateTitle = vision && Array.isArray(vision.titleCandidates)
      ? vision.titleCandidates.find((x) => !isGenericDescription(x))
      : '';
    // VLM is optional for curation. When it produces nothing usable, leave the
    // description empty rather than stuffing the filename in — the service marks
    // such items needsReview so the user can name them, instead of lying.
    const description = visionSummary || candidateTitle || '';

    // Protagonist = the matched actor whose cluster has the highest
    // (face area × frequency) score. This is the service's machine rule; the
    // service can still override it. Expose per-cluster scores so the service
    // doesn't have to recompute them.
    const clustersWithMatch = clusters.map((c) => {
      // match.faceClusters links clusterId -> person with the per-cluster score.
      const fc = match.faceClusters.find((x) => x.clusterId === c.clusterId);
      const m = fc
        ? match.matchedPeople.find((p) => p.personId === fc.matchedPersonId)
        : null;
      return {
        clusterId: c.clusterId,
        embedding: c.embedding,
        frameCount: c.frameCount,
        avgFaceArea: c.avgFaceArea,
        protagonistScore: Math.round((c.avgFaceArea || 0) * c.frameCount),
        bestFrameIndex: c.bestFaceIndex,
        sampleImageBase64: c.sampleImageBase64 || '',
        bbox: c.bbox,
        matchedPersonId: fc && fc.matchedPersonId || '',
        matchedName: fc && fc.matchedName || (m && m.name) || '',
        matchConfidence: fc && fc.confidence || 0,
        referenceFaceId: fc && fc.referenceFaceId || '',
        status: fc ? 'named' : 'unknown',
      };
    }).sort((a, b) => b.protagonistScore - a.protagonistScore);

    const protagonist = clustersWithMatch.find((c) => c.status === 'named') || null;
    const actorLabel = protagonist ? protagonist.matchedName : (match.actors[0] || 'Unknown Person');

    // Best keyframe = the frame holding the protagonist's (or largest) face.
    // Falls back to the brightest sampled frame if no faces were found.
    let posterFrameIndex = 0;
    if (clustersWithMatch.length) {
      posterFrameIndex = (protagonist || clustersWithMatch[0]).bestFrameIndex;
    } else {
      let bestBright = -1;
      for (let i = 0; i < frames.length; i++) {
        const s = fs.statSync(frames[i]).size;
        if (s > bestBright) { bestBright = s; posterFrameIndex = i; }
      }
    }
    // Also expose a handful of representative keyframes (per-scene bests) as an
    // image wall for browsing.
    const galleryFrames = pickGalleryFrames(frames, clustersWithMatch, faceResult.faces);
    const galleryImages = galleryFrames.map((i) => ({
      frameIndex: i,
      imageBase64: fs.readFileSync(frames[i]).toString('base64'),
    }));

    const referenceImage = protagonist
      ? referenceImageForPerson(job.people, protagonist.matchedPersonId, protagonist.referenceFaceId)
      : null;
    const compositePoster = await buildWesternCompositePoster({
      actorName: actorLabel,
      sceneTitle: description || titleWordsFromFilename(asset.sourceFileName),
      referenceImage,
      galleryImages,
    });
    const posterImageBase64 = compositePoster.base64 || fs.readFileSync(frames[posterFrameIndex]).toString('base64');

    const unknownFaces = clustersWithMatch.filter((c) => c.status === 'unknown');

    job.result = {
      title: safeName(`${actorLabel} - ${description || 'Scene'}`.trim()),
      generatedTitle: safeName(`${actorLabel} - ${description || 'Scene'}`.trim()),
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
      tags: [...new Set([...(vision && Array.isArray(vision.tags) ? vision.tags.map(String) : []), 'western_adult'])],
      genres: ['Adult'],
      scene: {
        setting: vision && vision.setting || '',
        style: vision && vision.style || '',
        performerCount: vision && Number(vision.performerCount) || clustersWithMatch.length || 0,
        summary: description,
        visionError: vision && vision.error || '',
        faceError: faceResult.error || '',
        visionUsable: !!(visionSummary || candidateTitle),
      },
      faceClusters: clustersWithMatch,
      unknownFaces,
      posterImageBase64,
      posterFrameIndex,
      galleryImages,
      // needsReview here reflects "no protagonist named"; the service maps this
      // to scrape failure (UNK) per the agreed lifecycle.
      needsReview: !protagonist,
      ai: {
        worker: 'media-worker',
        provider: 'node-local',
        matchMode: match.faceClusters.length ? 'face_embedding' : (match.actors.length ? 'people-alias' : 'none'),
        visionModel: cfg.visionModel || '',
        visionEnabled: !!job.options.vlmEnabled,
        visionUsable: !!(visionSummary || candidateTitle),
        faceEmbeddingsEnabled: !!cfg.faceEmbeddingsUrl && !!job.options.faceRecognitionEnabled,
        posterMode: compositePoster.mode || 'keyframe',
        posterError: compositePoster.error || '',
        frameCount: frames.length,
        clusterCount: clusters.length,
        faceCount: faceResult.faces.length,
        assetId: asset.assetId,
      },
    };
    job.progress = 100;
    job.status = 'done';
    job.updatedAt = new Date().toISOString();
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
    job.updatedAt = new Date().toISOString();
  } finally {
    aiBusy = false;
  }
}

function registerRoutes(server, helpers) {
  const cfg = helpers.config.loadConfig();
  init(cfg);

  server.post('/api/v1/assets', async (req, reply) => {
    const body = req.body || {};
    const assetId = safeId(body.assetId || crypto.randomUUID());
    const sourceFileName = safeName(body.sourceFileName || 'source.mkv', 'source.mkv');
    const dir = assetDir(cfg, assetId);
    ensureDir(dir);
    const rec = {
      assetId,
      assetKey: String(body.assetKey || assetId),
      sourceFileName,
      sourceFileSize: Number(body.sourceFileSize) || 0,
      fingerprint: body.fingerprint || null,
      localPath: path.join(dir, sourceFileName),
      status: 'pending_upload',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    assets.set(assetId, rec);
    persistAssets(cfg);
    return reply.code(201).send({ ok: true, assetId, status: rec.status });
  });

  server.put('/api/v1/assets/:id/source', async (req, reply) => {
    const assetId = safeId(req.params.id);
    const asset = assets.get(assetId);
    if (!asset) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    ensureDir(path.dirname(asset.localPath));
    const ws = fs.createWriteStream(asset.localPath);
    try {
      await pipeline(req.body, ws);
    } catch (e) {
      await fsp.unlink(asset.localPath).catch(() => {});
      asset.status = 'error';
      asset.error = e.message;
      persistAssets(cfg);
      return reply.code(500).send({ error: { code: 'UPLOAD_FAILED', message: e.message } });
    }
    const stat = fs.statSync(asset.localPath);
    asset.status = 'ready';
    asset.sourceFileSize = stat.size;
    asset.lastUsedAt = new Date().toISOString();
    persistAssets(cfg);
    return { ok: true, assetId, status: asset.status, bytesReceived: stat.size };
  });

  server.get('/api/v1/assets/:id', async (req, reply) => {
    const asset = assets.get(safeId(req.params.id));
    if (!asset) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    return { ...asset, localPath: undefined };
  });

  server.post('/api/v1/ai/reference-face', async (req, reply) => {
    const body = req.body || {};
    const image = imageBufferFromBase64(body.imageBase64 || body.data);
    if (!image) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'imageBase64 is required' } });

    const refId = safeId(body.referenceId || crypto.randomUUID());
    const dir = path.join(cfg.aiDataRoot, 'reference-faces');
    ensureDir(dir);
    const file = path.join(dir, `${refId}.jpg`);
    await fsp.writeFile(file, image);
    const faceResult = await callFaceEmbeddingModel(cfg, [file], {});
    if (faceResult.error) {
      return reply.code(502).send({ error: { code: 'FACE_MODEL_FAILED', message: faceResult.error } });
    }
    if (!faceResult.faces.length) {
      return reply.code(422).send({ error: { code: 'NO_FACE_DETECTED', message: 'No face detected in reference image' } });
    }
    const face = [...faceResult.faces].sort((a, b) => (b.faceArea || 0) - (a.faceArea || 0))[0];
    return {
      ok: true,
      face: {
        faceId: refId,
        embedding: face.embedding || [],
        bbox: face.bbox || null,
        detectionScore: face.detectionScore || face.confidence || 0,
        faceCount: faceResult.faces.length,
        sampleImageBase64: face.sampleImageBase64 || '',
      },
    };
  });

  server.post('/api/v1/ai/jobs', async (req, reply) => {
    const body = req.body || {};
    const jobId = safeId(body.jobId || crypto.randomUUID());
    if (aiJobs.has(jobId)) return reply.code(409).send({ error: { code: 'CONFLICT', message: 'AI job already exists' } });
    const assetId = safeId(body.assetId || '');
    if (!assets.has(assetId)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Asset not found' } });
    const job = {
      jobId,
      assetId,
      itemName: body.itemName || '',
      people: Array.isArray(body.people) ? body.people : [],
      options: {
        frameSampleCount: Number(body.options && body.options.frameSampleCount) || 36,
        frameWidth: Number(body.options && body.options.frameWidth) || 640,
        faceRecognitionEnabled: body.options ? body.options.faceRecognitionEnabled !== false : true,
        vlmEnabled: body.options ? body.options.vlmEnabled !== false : true,
        allowExplicitGeneratedText: body.options ? body.options.allowExplicitGeneratedText !== false : true,
        // Dismissed-actor embeddings to exclude from detection (protagonist
        // selection must never pick a dismissed face).
        blacklist: Array.isArray(body.options && body.options.blacklist) ? body.options.blacklist : [],
        blacklistThreshold: Number(body.options && body.options.blacklistThreshold) || 0.5,
        faceSimilarityThreshold: Number(body.options && body.options.faceSimilarityThreshold) || 0,
      },
      status: 'queued',
      progress: 0,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    aiJobs.set(jobId, job);
    runAiJob(jobId, helpers).catch(() => {});
    return reply.code(201).send({ ok: true, jobId, status: job.status });
  });

  server.get('/api/v1/ai/jobs/:id', async (req, reply) => {
    const job = aiJobs.get(safeId(req.params.id));
    if (!job) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'AI job not found' } });
    return job;
  });
}

module.exports = {
  registerRoutes,
  init,
  __private: {
    buildWesternCompositePoster,
    referenceImageForPerson,
  },
};
