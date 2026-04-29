/**
 * Tier 2/3 Integration Test Setup
 *
 * Spawns media-service on a known port, waits for health check,
 * tears down after all tests complete.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const SERVICE_PORT = 18090;
export const SERVICE_URL = `http://127.0.0.1:${SERVICE_PORT}`;

let serviceProc: ChildProcess | null = null;
let resolveReady: (() => void) | null = null;
let rejectReady: ((e: Error) => void) | null = null;
export const serviceReady = new Promise<void>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

export async function startService() {
  const serviceRoot = path.resolve(__dirname, '..', '..', 'media-service');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-inttest-'));

  serviceProc = spawn('node', ['src/server.js'], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      MEDIA_SERVICE_PORT: String(SERVICE_PORT),
      MEDIA_SERVICE_DATA_DIR: dataDir,
      MEDIA_SERVICE_API_KEY: '', // no auth for tests
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let started = false;

  serviceProc.stdout?.on('data', (chunk: Buffer) => {
    // Don't log service output to keep test output clean
    void chunk;
  });

  serviceProc.stderr?.on('data', (chunk: Buffer) => {
    void chunk;
  });

  serviceProc.on('exit', (code) => {
    if (!started) {
      rejectReady?.(new Error(`Service exited with code ${code} before becoming ready`));
    }
  });

  // Poll health endpoint until ready
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(`${SERVICE_URL}/v1/health`);
      if (r.ok) {
        started = true;
        resolveReady?.();
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  rejectReady?.(new Error(`Service did not become ready within ${maxAttempts * 0.5}s`));
}

export async function stopService() {
  if (serviceProc) {
    serviceProc.kill('SIGTERM');
    // Wait up to 5s for graceful shutdown
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        serviceProc?.kill('SIGKILL');
        resolve();
      }, 5000);
      serviceProc?.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    serviceProc = null;
  }
}

// Vitest global setup/teardown
export const setup = startService;
export const teardown = stopService;
