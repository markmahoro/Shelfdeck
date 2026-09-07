'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest, canonicalJson } = require('../contracts/canonical-json');
const MAX_BYTES = 16384;
function createFailureEvidenceStore(root) {
  const directory = path.resolve(root);
  function location(digest) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError('Invalid failure evidence digest.');
    return path.join(directory, digest + '.json');
  }
  return Object.freeze({
    write(evidence) {
      const body = canonicalJson(evidence), digest = canonicalDigest(evidence);
      if (Buffer.byteLength(body) > MAX_BYTES) throw new RangeError('Failure evidence exceeds its bounded size.');
      fs.mkdirSync(directory, { recursive:true });
      const target = location(digest);
      const temporary = target + '.' + require('node:crypto').randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temporary, body, { flag:'wx', mode:0o600 });
        try { fs.linkSync(temporary, target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      if (canonicalDigest(this.read(digest)) !== digest) throw new Error('Failure evidence verification failed.');
      return digest;
    },
    read(digest) {
      const target = location(digest);
      let stat;
      try { stat = fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('Failure evidence file is invalid.');
      const evidence = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (canonicalDigest(evidence) !== digest) throw new Error('Failure evidence digest mismatch.');
      return Object.freeze(evidence);
    },
  });
}
module.exports = Object.freeze({ createFailureEvidenceStore });
