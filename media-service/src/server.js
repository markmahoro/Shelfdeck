'use strict';

const path = require('node:path');
const { createCleanServiceHost } = require('./clean-service-host');

function runtimeOptions(env = process.env) {
  return Object.freeze({
    port: Number(env.MEDIA_SERVICE_PORT || 18080),
    host: env.MEDIA_SERVICE_HOST || '0.0.0.0',
    dataDir: path.resolve(env.MEDIA_SERVICE_DATA_DIR || path.join(__dirname, '..', 'data')),
    adminDistDir: path.resolve(env.MEDIA_SERVICE_ADMIN_DIST_DIR || path.join(__dirname, '..', 'dist', 'admin')),
    secretRoot: env.SHELFDECK_SECRET_ROOT,
  });
}

async function main(options = runtimeOptions()) {
  const service = await createCleanServiceHost(options);
  let closing;
  const shutdown = (signal) => {
    if (!closing) {
      console.log(`[shelfdeck] received ${signal}; stopping clean service`);
      closing = service.close()
        .then(() => console.log('[shelfdeck] clean service stopped'))
        .catch((error) => {
          console.error('[shelfdeck] clean shutdown failed', error);
          process.exitCode = 1;
        });
    }
    return closing;
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  await service.listen({ port: options.port, host: options.host });
  console.log(`[shelfdeck] clean service listening on ${options.host}:${options.port}`);
  return Object.freeze({ service, shutdown });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[shelfdeck] clean service startup failed', {
      code: error.code || 'CLEAN_SERVICE_STARTUP_FAILED',
      message: error.message,
      details: error.details || {},
    });
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ main, runtimeOptions });
