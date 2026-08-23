'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createCleanServiceHost } = require('../../src/clean-service-host');

const runRoot = path.resolve(process.env.SHELFDECK_PEOPLE_E2E_ROOT || '');
const allowedRoot = path.resolve('F:\\shelfdeck_test_zone\\runs');
const relative = path.relative(allowedRoot, runRoot);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('SHELFDECK_PEOPLE_E2E_ROOT must be inside the F: qualification runs root.');
}
const privateRuntime = JSON.parse(fs.readFileSync(path.join(runRoot, 'private-runtime.json'), 'utf8'));
const png = fs.readFileSync(path.resolve(__dirname, '../public/icon-192.png'));

function response(status, value, contentType = 'application/json') {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');
  return new Response(bytes, { status, headers: { 'content-type': contentType, 'content-length': String(bytes.length) } });
}

async function integrationFetch(input) {
  const url = new URL(String(input));
  if (url.hostname === 'image.tmdb.org') return response(200, png, 'image/png');
  const match = url.pathname.match(/^\/3\/person\/(\d+)$/);
  if (match) {
    return response(200, {
      id: Number(match[1]),
      name: `Qualification Person ${match[1]}`,
      profile_path: match[1] === '80015' ? null : `/qualification-person-${match[1]}.png`,
    });
  }
  return response(404, { status_code: 34 });
}

async function main() {
  const host = await createCleanServiceHost({
    dataDir: path.join(runRoot, 'data'),
    adminDistDir: path.resolve(__dirname, '../../dist/admin'),
    secretRoot: privateRuntime.secretRoot,
    integrationFetch,
    onRequestError(error, request) {
      if (['ADMIN_SESSION_INVALID', 'PEOPLE_AVATAR_NOT_AVAILABLE'].includes(error.code)) return;
      process.stderr.write(`${request.method} ${request.path} ${request.correlationId} ${error.stack || error.message}\n`);
    },
    libraWorkspaceRoot: path.join(runRoot, 'workspace'),
    integrationReservedRoots: [path.join(runRoot, 'field'), path.join(runRoot, 'shelf')],
  });
  const close = async () => {
    await host.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  await host.listen({ host: '127.0.0.1', port: Number(process.env.SHELFDECK_PEOPLE_E2E_PORT || 18182) });
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.name}: ${error.message}\n`);
  process.exit(1);
});
