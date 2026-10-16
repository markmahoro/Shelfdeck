'use strict';

const path = require('node:path');
const fastifyStatic = require('@fastify/static');

async function registerAdminStatic(server, adminDistDir) {
  // Register only the build's existing exact routes. A bounded larger file
  // read avoids making every small JS/CSS chunk wait behind an Owner turn.
  // sendFile still owns range, conditional requests, containment and headers.
  server.addHook('onRoute', route => {
    if (/^\/assets\/[^/?]+\.(?:js|css)$/.test(route.url)) {
      const file = route.url.slice(1);
      route.handler = (_request, reply) => reply.sendFile(file, {highWaterMark:512 * 1024});
    }
  });
  await server.register(fastifyStatic, {
    root:path.resolve(adminDistDir), prefix:'/', wildcard:false, cacheControl:false,
    setHeaders(reply, filePath) {
      if (path.basename(filePath) === 'index.html') reply.header('Cache-Control', 'no-store');
    },
  });
}

module.exports = Object.freeze({registerAdminStatic});
