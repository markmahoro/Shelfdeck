'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Agent, fetch } = require('undici');
const manifest = require('../src/helix/contracts/buffalo-model-pack.json');

// Download URLs live here (not in buffalo-model-pack.json) so FaceModelRef digests stay stable.
const DOWNLOAD_URLS = Object.freeze({
  'det_10g.onnx': 'https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/det_10g.onnx',
  'w600k_r50.onnx': 'https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/w600k_r50.onnx',
});

function verify(file, model) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== model.bytes ||
      createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== model.sha256) {
    throw Object.assign(new Error('Pinned buffalo model checksum validation failed: ' + model.role), {
      code: 'BUFFALO_MODEL_PACK_INVALID',
    });
  }
}

async function installBuffaloModels(target, options = {}) {
  const root = path.resolve(target);
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Buffalo model output directory cannot be a symbolic link.');
  const dispatcher = options.dispatcher || new Agent({ connect: { family: 4, timeout: 60000 } });
  try {
    for (const model of manifest.models) {
      const file = path.join(root, model.file);
      if (fs.existsSync(file)) { verify(file, model); continue; }
      const url = options.urls?.[model.file] || DOWNLOAD_URLS[model.file];
      if (typeof url !== 'string' || !url) {
        throw Object.assign(new Error('Buffalo model pack is missing a pinned download URL: ' + model.role), {
          code: 'BUFFALO_MODEL_PACK_INVALID',
        });
      }
      const temporary = path.join(root, '.' + model.file + '.' + randomUUID() + '.part');
      let fd;
      try {
        // Hugging Face resolve URLs redirect to a CDN; follow redirects, then pin by size+SHA.
        const response = await (options.fetch || fetch)(url, {
          dispatcher, redirect: 'follow', signal: AbortSignal.timeout(options.timeoutMs || 600000),
        });
        if (!response.ok || !response.body) throw new Error('Buffalo model download failed: HTTP ' + response.status);
        fd = fs.openSync(temporary, 'wx', 0o600);
        let total = 0;
        const hash = createHash('sha256');
        for await (const chunk of response.body) {
          total += chunk.length;
          if (total > model.bytes) throw new Error('Buffalo model download exceeds its pinned size.');
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
        }
        if (total !== model.bytes || hash.digest('hex') !== model.sha256) {
          throw new Error('Buffalo model download does not match its pinned checksum.');
        }
        fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        try { fs.linkSync(temporary, file); }
        catch (error) { if (error.code !== 'EEXIST') throw error; verify(file, model); }
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      verify(file, model);
    }
    return Object.freeze({ modelId: manifest.modelId, verifiedModels: manifest.models.length, root });
  } finally { if (!options.dispatcher) await dispatcher.close(); }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--target')) {
    throw new Error('Usage: node install-buffalo-models.js [--target directory]');
  }
  installBuffaloModels(args[1] || path.resolve(__dirname, '../resources/buffalo-models'))
    .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}

module.exports = Object.freeze({ installBuffaloModels, DOWNLOAD_URLS });
