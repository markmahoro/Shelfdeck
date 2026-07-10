'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cleanState = require('../../src/helixCleanState');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-admin-e2e-'));
cleanState.applyCleanInit({ dataDir, confirmation: cleanState.APPLY_CONFIRMATION });

async function main() {
  const { buildApp } = require('../../src/app');
  const app = await buildApp({ logger: false, dataDir, apiKey: '' });
  const close = async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  await app.listen({ host: '127.0.0.1', port: 18181 });
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(1);
});
