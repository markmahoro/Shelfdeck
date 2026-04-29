'use strict';

const { buildApp } = require('./app');
const { startTray } = require('./tray');

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

  startTray(PORT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
