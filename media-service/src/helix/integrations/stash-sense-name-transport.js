'use strict';

const { createHash } = require('node:crypto');
const { canonicalDigest, canonicalJson } = require('../contracts/canonical-json');
const { fetchJson } = require('./h1-provider-adapters');

const POLICY = Object.freeze({ policyRef: 'stash-sense.name-observation@1', topK: 5,
  maxDistance: 0.6, minFaceConfidence: 0.5, maxImageBytes: 8 * 1024 * 1024, maxResponseBytes: 1024 * 1024 });
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value))
    fail('STASH_SENSE_RESPONSE_INVALID', 'Recognition returned an invalid bounded performer name.');
  return value.trim();
}
function number(value, minimum, maximum) { return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum; }
function sourceRef(value, bytes) {
  if (!value || canonicalJson(Object.keys(value).sort()) !== canonicalJson(['artifactHandleId', 'artifactRevision', 'sha256', 'sizeBytes']) ||
      typeof value.artifactHandleId !== 'string' || !value.artifactHandleId || value.artifactHandleId.length > 256 ||
      !Number.isSafeInteger(value.artifactRevision) || value.artifactRevision < 1 ||
      !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > POLICY.maxImageBytes || value.sizeBytes !== bytes.length ||
      value.sha256 !== createHash('sha256').update(bytes).digest('hex'))
    fail('STASH_SENSE_IMAGE_FENCE', 'Recognition requires the exact bounded source image Artifact bytes.');
  return { ...value };
}
function project(raw, imageRef, serviceRevisionDigest) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.faces) || raw.faces.length > 32 || raw.face_count !== raw.faces.length)
    fail('STASH_SENSE_RESPONSE_INVALID', 'Recognition returned an inconsistent bounded face set.');
  const faces = raw.faces.map(face => {
    const box = face?.box;
    if (!box || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(box[key])) ||
        box.x < 0 || box.y < 0 || box.width < 1 || box.height < 1 || !number(box.confidence, 0, 1) ||
        !Array.isArray(face.matches) || face.matches.length > POLICY.topK)
      fail('STASH_SENSE_RESPONSE_INVALID', 'Recognition returned invalid face geometry or candidate bounds.');
    const candidates = face.matches.map(match => {
      if (!number(match?.confidence, 0, 1) || !number(match.distance, 0, 2))
        fail('STASH_SENSE_RESPONSE_INVALID', 'Recognition returned an invalid confidence or distance.');
      const canonicalName = name(match.name), original = match.original_name == null ? null : name(match.original_name);
      // External catalogue identifiers and image URLs never establish a People identity.
      return { name: canonicalName, aliases: original && original !== canonicalName ? [original] : [],
        confidence: match.confidence, distance: match.distance };
    }).filter(match => match.distance <= POLICY.maxDistance)
      .sort((a, b) => a.distance - b.distance || Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
    return { box: { x: box.x, y: box.y, width: box.width, height: box.height, confidence: box.confidence }, candidates };
  });
  let resultKind = 'unmatched', matches = [];
  const qualified = faces.filter(face => face.box.confidence >= POLICY.minFaceConfidence && face.candidates.length);
  if (qualified.length) {
    // The caller submits its exact selected face image. More than one detected
    // face cannot silently choose which media performer the user intended.
    if (faces.length !== 1) resultKind = 'ambiguous';
    else {
      const face = qualified[0], distance = face.candidates[0].distance, seen = new Set();
      matches = face.candidates.filter(candidate => candidate.distance === distance).filter(candidate => {
        const key = candidate.name.normalize('NFKC').toLowerCase();
        if (seen.has(key)) return false; seen.add(key); return true;
      }).map(candidate => ({ ...candidate, faceBox: face.box }));
      resultKind = matches.length === 1 ? 'matched' : 'ambiguous';
    }
  }
  const body = { schemaRef: 'integration.stash-sense-name-observation@1', policyRef: POLICY.policyRef,
    serviceRevisionDigest, sourceImageRef: imageRef, resultKind, detectedFaceCount: faces.length,
    matches, responseDigest: canonicalDigest(raw) };
  return freeze({ ...body, observationDigest: canonicalDigest(body) });
}

// Private Integration transport. Composition must supply a Platform-qualified
// service configuration and a formal Work must own each invocation; this client
// does not register Persons, select media actors, or manage the remote process.
function createStashSenseNameTransport({ endpoint, configRevision, fetchImpl, maxConcurrent = 1 }) {
  let url;
  try { url = new URL(endpoint); } catch { fail('STASH_SENSE_CONFIG_INVALID', 'Recognition endpoint is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      !Number.isSafeInteger(configRevision) || configRevision < 1 || typeof fetchImpl !== 'function' ||
      !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4)
    fail('STASH_SENSE_CONFIG_INVALID', 'Recognition requires one qualified service revision and bounded transport.');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/identify';
  const serviceRevisionDigest = canonicalDigest({ schema: 'integration.stash-sense-service@1',
    endpoint: new URL(endpoint).toString(), configRevision }), target = url.toString();
  let inFlight = 0;
  return Object.freeze({ async identify({ imageBytes, imageRef, timeoutMs, signal }) {
    const sourceImageRef = sourceRef(imageRef, imageBytes);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
      fail('STASH_SENSE_TIMEOUT_INVALID', 'Recognition requires one bounded operation deadline.');
    if (signal !== undefined && !(signal instanceof AbortSignal))
      fail('STASH_SENSE_INPUT_INVALID', 'Recognition cancellation must be an AbortSignal.');
    if (signal?.aborted) fail('STASH_SENSE_CANCELLED', 'Recognition was cancelled before submission.');
    if (inFlight >= maxConcurrent) fail('STASH_SENSE_CAPACITY_UNAVAILABLE', 'Recognition caller capacity is occupied.');
    inFlight++;
    const controller = new AbortController(), cancel = () => controller.abort(),
      timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.(); signal?.addEventListener('abort', cancel, { once: true });
    try {
      const raw = await fetchJson(fetchImpl, target, { method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/json', accept: 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ image_base64: imageBytes.toString('base64'), top_k: POLICY.topK,
          max_distance: POLICY.maxDistance, min_face_confidence: POLICY.minFaceConfidence }) }, POLICY.maxResponseBytes);
      if (controller.signal.aborted) fail(signal?.aborted ? 'STASH_SENSE_CANCELLED' : 'STASH_SENSE_TIMEOUT', 'Recognition did not finish within its active invocation.');
      return project(raw, sourceImageRef, serviceRevisionDigest);
    } catch (error) {
      if (controller.signal.aborted) fail(signal?.aborted ? 'STASH_SENSE_CANCELLED' : 'STASH_SENSE_TIMEOUT', 'Recognition did not finish within its active invocation.');
      throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); inFlight--;
    }
  } });
}

module.exports = Object.freeze({ POLICY, createStashSenseNameTransport });
