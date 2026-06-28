'use strict';

const { buildApp } = require('./app');
let startTray = null;
if (process.platform === 'win32') {
  try {
    startTray = require('./tray').startTray;
  } catch (_) {
    console.log('[media-service] tray module not available');
  }
} else {
  console.log('[media-service] tray disabled on non-Windows runtime');
}

const PORT = Number(process.env.MEDIA_SERVICE_PORT || process.env.CONTROL_PLANE_PORT || 18080);

async function main() {
  const app = await buildApp();

  const shutdown = async (signal) => {
    console.log(`[media-service] received ${signal}, shutting down...`);
    // Kill all tracked ffmpeg processes before exit
    try {
      const transcodeService = require('./services/transcodeService');
      transcodeService.abortAllEncodes();
      console.log('[media-service] killed all encoding processes');
    } catch (_) {}
    try {
      await app.close();
    } catch (e) {
      console.error('[media-service] close error:', e);
    }
    console.log('[media-service] shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[media-service] listening on http://127.0.0.1:${PORT}`);

  if (startTray) startTray(PORT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
