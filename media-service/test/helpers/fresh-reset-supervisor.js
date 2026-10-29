'use strict';

const fs = require('node:fs'), path = require('node:path');
const { createRuntimeSupervisor } = require('../../src/clean-runtime-supervisor');

async function createFreshResetTestHost(options, { workspaceRoots, protectedDirectories }) {
  const root = path.dirname(options.dataDir), operationRoot = path.join(root, 'reset-operations'), backupParent = path.join(root, 'reset-archives');
  for (const folder of [operationRoot, backupParent, ...workspaceRoots]) fs.mkdirSync(folder, { recursive: true });
  const supervisor = createRuntimeSupervisor({ ...options, host: '127.0.0.1', port: 0,
    resetConfiguration: { schema: 'shelfdeck.reset-configuration@1', operationRoot, backupParent,
      backupSourceOptions: { roots: [{ id: 'data', path: options.dataDir }, ...workspaceRoots.map((directory, index) => ({ id: 'workspace-' + index, path: directory }))] },
      storage: { roots: workspaceRoots, protectedDirectories } } });
  await supervisor.start();
  return { ...supervisor,
    async inject(request) {
      // During a transport handover the old Fastify listener may already be
      // closed. Retry only reads; never replay arbitrary user mutations here.
      for (let attempt = 0; ; attempt++) {
        try { return await supervisor.inject(request); }
        catch (error) {
          if (request.method !== 'GET' || !['FST_ERR_REOPENED_CLOSE_SERVER', 'FST_ERR_INSTANCE_ALREADY_LISTENING'].includes(error.code) || attempt >= 100) throw error;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
    },
    listen: async () => `http://127.0.0.1:${supervisor.address().port}`,
  };
}

module.exports = Object.freeze({ createFreshResetTestHost });
