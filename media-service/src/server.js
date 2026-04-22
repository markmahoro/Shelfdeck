'use strict';

const { buildApp } = require('./app');
const taskScheduler = require('./taskScheduler');

const PORT = Number(process.env.MEDIA_SERVICE_PORT || process.env.CONTROL_PLANE_PORT || 18080);

async function main() {
  const app = await buildApp();

  // SIGTERM/SIGINT 关闭钩子：停止调度器后关闭 HTTP 服务
  const shutdown = async (signal) => {
    console.log(`[media-service] received ${signal}, shutting down...`);
    taskScheduler.stopScheduler();
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

  /** Windows 本机单实例：以端口独占为主（ADR_001）；第二实例在 listen 阶段失败退出。 */
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[media-service] listening on http://127.0.0.1:${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
