'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Agent, fetch } = require('undici');
const manifest = require('../src/helix/contracts/us-adult-face-model-pack.json');

function verify(file, model) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== model.size ||
      createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== model.sha256) {
    throw Object.assign(new Error('Pinned model checksum validation failed: ' + model.role), { code: 'FACE_MODEL_PACK_INVALID' });
  }
}

async function installFaceModels(target, options = {}) {
  const root = path.resolve(target);
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Model output directory cannot be a symbolic link.');
  const dispatcher = options.dispatcher || new Agent({ connect: { family: 4, timeout: 20000 } });
  try {
    for (const model of manifest.models) {
      const file = path.join(root, model.file);
      if (fs.existsSync(file)) { verify(file, model); continue; }
      const temporary = path.join(root, '.' + model.file + '.' + randomUUID() + '.part');
      let fd;
      try {
        const response = await (options.fetch || fetch)(model.url, { dispatcher, redirect: 'error', signal: AbortSignal.timeout(120000) });
        if (!response.ok || !response.body) throw new Error('Model download failed: HTTP ' + response.status);
        fd = fs.openSync(temporary, 'wx', 0o600);
        let total = 0;
        const hash = createHash('sha256');
        for await (const chunk of response.body) {
          total += chunk.length;
          if (total > model.size) throw new Error('Model download exceeds its pinned size.');
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
        }
        if (total !== model.size || hash.digest('hex') !== model.sha256) throw new Error('Model download does not match its pinned checksum.');
        fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        // Atomic publication must not overwrite a concurrently installed model.
        try { fs.linkSync(temporary, file); }
        catch (error) { if (error.code !== 'EEXIST') throw error; verify(file, model); }
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      verify(file, model);
    }
    return Object.freeze({ modelRef: manifest.modelRef, verifiedModels: manifest.models.length });
  } finally { if (!options.dispatcher) await dispatcher.close(); }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--target')) throw new Error('Usage: node install-face-models.js [--target directory]');
  installFaceModels(args[1] || path.resolve(__dirname, '../resources/face-models'))
    .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}

module.exports = Object.freeze({ installFaceModels });
