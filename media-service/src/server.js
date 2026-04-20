'use strict';

const { buildApp } = require('./app');

const PORT = Number(process.env.MEDIA_SERVICE_PORT || process.env.CONTROL_PLANE_PORT || 18080);

async function main() {
  const app = await buildApp();
  /** Windows 本机单实例：以端口独占为主（ADR_001）；第二实例在 listen 阶段失败退出。 */
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[media-service] listening on http://127.0.0.1:${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
