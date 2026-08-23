'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createCleanServiceHost } = require('../../src/clean-service-host');

const root = path.resolve(process.env.SHELFDECK_PEOPLE_REAL_ROOT || '');
const allowedRoot = path.resolve('F:\\shelfdeck_test_zone\\runs');
const relative = path.relative(allowedRoot, root);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('SHELFDECK_PEOPLE_REAL_ROOT must be inside the F: qualification runs root.');
}
const privateRuntime = JSON.parse(fs.readFileSync(path.join(root, 'private-runtime.json'), 'utf8'));

async function main() {
  const host = await createCleanServiceHost({
    dataDir: path.join(root, 'data'), adminDistDir: path.resolve(__dirname, '../../dist/admin'),
    secretRoot: privateRuntime.secretRoot, libraWorkspaceRoot: path.join(root, 'workspace'),
    integrationReservedRoots: [path.join(root, 'field'), path.join(root, 'shelf')],
    onRequestError(error, request) {
      if (['ADMIN_SESSION_INVALID', 'PEOPLE_AVATAR_NOT_AVAILABLE'].includes(error.code)) return;
      process.stderr.write(`${request.method} ${request.path} ${request.correlationId} ${error.stack || error.message}\n`);
    },
  });
  const close = async () => {
    await host.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  await host.listen({ host: '127.0.0.1', port: Number(process.env.SHELFDECK_PEOPLE_REAL_PORT || 18183) });
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.name}: ${error.message}\n`);
  process.exit(1);
});
