'use strict';

const ALIGNMENT_POINTS = Object.freeze([
  [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041],
]);

function invalid(message) {
  throw Object.assign(new TypeError(message), { code: 'FACE_VECTOR_INVALID' });
}

function normalizeVector(vector) {
  if (!vector || !Number.isSafeInteger(vector.length) || vector.length < 1 || vector.length > 4096) invalid('Face vector dimension is invalid.');
  let square = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) invalid('Face vector contains a non-finite value.');
    square += value * value;
  }
  if (square < 1e-12) invalid('Face vector has no measurable magnitude.');
  const norm = Math.sqrt(square);
  return Array.from(vector, value => value / norm);
}

function cosineSimilarity(left, right) {
  if (left?.length !== right?.length) invalid('Face vectors use different dimensions.');
  const a = normalizeVector(left), b = normalizeVector(right);
  return Math.max(-1, Math.min(1, a.reduce((sum, value, index) => sum + value * b[index], 0)));
}

function bestActorMatch(vectors, references, threshold = 0.363) {
  if (!Array.isArray(vectors) || !Array.isArray(references) || !Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
    invalid('Matching requires bounded vector sets and a valid threshold.');
  }
  if (vectors.length > 4096 || references.length > 65536) invalid('Face matching exceeds its batch budget.');
  let best = null;
  for (const reference of references) {
    if (reference.libraryKind !== 'us_adult' || typeof reference.personId !== 'string' || !reference.personId) {
      throw Object.assign(new TypeError('Matching requires a US Adult Person reference.'), { code: 'FACE_REFERENCE_LIBRARY_INVALID' });
    }
    for (const [vectorIndex, vector] of vectors.entries()) {
      const score = cosineSimilarity(vector, reference.vector);
      if (score < threshold) continue;
      const order = best && Buffer.compare(Buffer.from(reference.personId), Buffer.from(best.personId));
      if (!best || score > best.score || score === best.score && order < 0) {
        best = { personId: reference.personId, score, vectorIndex, referenceRevision: reference.referenceRevision };
      }
    }
  }
  return best && Object.freeze(best);
}

function intersectionOverUnion(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlap = width * height;
  return overlap / Math.max(1e-12, a.width * a.height + b.width * b.height - overlap);
}

function decodeYuNet(outputs, inputSize = 320, threshold = 0.8) {
  const found = [];
  for (const stride of [8, 16, 32]) {
    const cls = outputs['cls_' + stride]?.data, obj = outputs['obj_' + stride]?.data;
    const boxes = outputs['bbox_' + stride]?.data, points = outputs['kps_' + stride]?.data;
    const cells = inputSize / stride;
    if (!cls || !obj || !boxes || !points || cls.length !== cells * cells || obj.length !== cls.length ||
        boxes.length !== cls.length * 4 || points.length !== cls.length * 10) {
      throw Object.assign(new Error('YuNet output does not match the pinned model contract.'), { code: 'FACE_MODEL_OUTPUT_INVALID' });
    }
    for (let index = 0; index < cls.length; index++) {
      const score = Math.sqrt(Math.max(0, Math.min(1, cls[index])) * Math.max(0, Math.min(1, obj[index])));
      if (score < threshold) continue;
      const column = index % cells, row = Math.floor(index / cells);
      const width = Math.exp(boxes[index * 4 + 2]) * stride, height = Math.exp(boxes[index * 4 + 3]) * stride;
      const x = (column + boxes[index * 4]) * stride - width / 2;
      const y = (row + boxes[index * 4 + 1]) * stride - height / 2;
      const landmarks = Array.from({ length: 5 }, (_, i) => [
        (column + points[index * 10 + i * 2]) * stride, (row + points[index * 10 + i * 2 + 1]) * stride,
      ]);
      if ([x, y, width, height, score, ...landmarks.flat()].some(value => !Number.isFinite(value)) || width <= 0 || height <= 0) continue;
      found.push({ x, y, width, height, score, landmarks });
    }
  }
  found.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);
  const selected = [];
  for (const face of found.slice(0, 5000)) {
    if (selected.every(previous => intersectionOverUnion(face, previous) <= 0.3)) selected.push(face);
    if (selected.length === 64) break;
  }
  return selected;
}

function alignRgb(data, width, height, landmarks) {
  if (!data || data.length !== width * height * 3 || landmarks?.length !== 5 ||
      landmarks.flat().length !== 10 || landmarks.flat().some(value => !Number.isFinite(value))) invalid('Face alignment input is invalid.');
  const sx = landmarks.reduce((sum, point) => sum + point[0], 0) / 5;
  const sy = landmarks.reduce((sum, point) => sum + point[1], 0) / 5;
  const dx = ALIGNMENT_POINTS.reduce((sum, point) => sum + point[0], 0) / 5;
  const dy = ALIGNMENT_POINTS.reduce((sum, point) => sum + point[1], 0) / 5;
  let numeratorA = 0, numeratorB = 0, denominator = 0;
  for (let i = 0; i < 5; i++) {
    const x = landmarks[i][0] - sx, y = landmarks[i][1] - sy;
    const u = ALIGNMENT_POINTS[i][0] - dx, v = ALIGNMENT_POINTS[i][1] - dy;
    numeratorA += x * u + y * v; numeratorB += x * v - y * u; denominator += x * x + y * y;
  }
  if (denominator < 1e-8) invalid('Face landmarks are degenerate.');
  const a = numeratorA / denominator, b = numeratorB / denominator, determinant = a * a + b * b;
  if (determinant < 1e-12) invalid('Face alignment is singular.');
  const tx = dx - a * sx + b * sy, ty = dy - b * sx - a * sy;
  const pixels = new Float32Array(3 * 112 * 112);
  const sample = (x, y, channel) => x < 0 || y < 0 || x >= width || y >= height ? 0 : data[(y * width + x) * 3 + channel];
  for (let y = 0; y < 112; y++) for (let x = 0; x < 112; x++) {
    const sourceX = (a * (x - tx) + b * (y - ty)) / determinant;
    const sourceY = (-b * (x - tx) + a * (y - ty)) / determinant;
    const left = Math.floor(sourceX), top = Math.floor(sourceY), fx = sourceX - left, fy = sourceY - top;
    for (let channel = 0; channel < 3; channel++) {
      pixels[channel * 112 * 112 + y * 112 + x] =
        sample(left, top, channel) * (1 - fx) * (1 - fy) + sample(left + 1, top, channel) * fx * (1 - fy) +
        sample(left, top + 1, channel) * (1 - fx) * fy + sample(left + 1, top + 1, channel) * fx * fy;
    }
  }
  return pixels;
}

module.exports = Object.freeze({ ALIGNMENT_POINTS, normalizeVector, cosineSimilarity, bestActorMatch, decodeYuNet, alignRgb });
