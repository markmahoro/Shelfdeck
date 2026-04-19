'use strict';

const { buildApp } = require('./app');

const PORT = Number(process.env.CONTROL_PLANE_PORT || 18080);

async function main() {
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[control-plane] listening on http://127.0.0.1:${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
