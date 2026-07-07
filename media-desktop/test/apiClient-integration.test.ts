/**
 * Tier 2 — Desktop ApiClient → Service Integration Tests
 *
 * Verifies every apiClient method against a real media-service process.
 * Service is started by setup.ts on port 18090.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiClient, ApiConflictError } from '../src/api/client';
import { startService, stopService, serviceReady, SERVICE_URL } from './setup';

beforeAll(async () => {
  await startService();
  await serviceReady;
}, 30000);

afterAll(async () => {
  await stopService();
}, 10000);

// ── Health ────────────────────────────────────────────────────────────────────────

describe('Health', () => {
  it('GET /v1/health returns valid status', async () => {
    const r = await fetch(`${SERVICE_URL}/v1/health`);
    expect(r.ok).toBe(true);
    const body = await r.json();
    expect(['green', 'yellow', 'red']).toContain(body.status);
  });
});

// ── Tasks: create / list / detail / delete ────────────────────────────────────────

describe('Task CRUD', () => {
  const itemId = `int-test-${Date.now()}`;

  it('createTaskByIntent returns 201 with task fields', async () => {
    const task = await apiClient.createTaskByIntent({ itemId, actionType: 'transcode' });
    expect(task.id).toBeTruthy();
    expect(task.itemId).toBe(itemId);
    expect(task.actionType).toBe('transcode');
    expect(['created', 'pending_manual']).toContain(task.status);
    expect(task.progress).toBe(0);
  });

  it('createTaskByIntent duplicate itemId throws ApiConflictError (409)', async () => {
    await expect(
      apiClient.createTaskByIntent({ itemId, actionType: 'delete' }),
    ).rejects.toThrow(ApiConflictError);
  });

  it('createTaskByIntent invalid actionType throws (400)', async () => {
    await expect(
      apiClient.createTaskByIntent({ itemId: 'bad-action-item', actionType: 'invalid' as 'transcode' }),
    ).rejects.toThrow(/400/);
  });

  it('getTasks returns array', async () => {
    const tasks = await apiClient.getTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const found = tasks.find((t) => t.itemId === itemId);
    expect(found).toBeTruthy();
    expect(found!.status).toBeTruthy();
  });

  it('getTasks filters by status', async () => {
    const tasks = await apiClient.getTasks({ status: 'created' });
    for (const t of tasks) {
      expect(t.status).toBe('created');
    }
  });

  it('getTasks filters by actionType', async () => {
    const tasks = await apiClient.getTasks({ actionType: 'transcode' });
    for (const t of tasks) {
      expect(t.actionType).toBe('transcode');
    }
  });

  it('getTask returns task detail with logs', async () => {
    const tasks = await apiClient.getTasks();
    const task = tasks.find((t) => t.itemId === itemId);
    expect(task).toBeTruthy();
    const detail = await apiClient.getTask(task!.id);
    expect(detail.id).toBe(task!.id);
    expect(Array.isArray(detail.logs)).toBe(true);
  });

  it('getTask non-existent throws (404)', async () => {
    await expect(apiClient.getTask('nonexistent-id')).rejects.toThrow(/404/);
  });

  it('deleteTask removes task', async () => {
    // Create a standalone task for deletion
    const created = await apiClient.createTaskByIntent({
      itemId: `del-test-${Date.now()}`,
      actionType: 'transcode',
    });
    await apiClient.deleteTask(created.id);
    await expect(apiClient.getTask(created.id)).rejects.toThrow(/404/);
  });

  it('deleteTask non-existent throws (404)', async () => {
    await expect(apiClient.deleteTask('nonexistent-id')).rejects.toThrow(/404/);
  });
});

// ── Tasks: pause / execute ───────────────────────────────────────────────────────

describe('Task pause & execute', () => {
  let taskId: string;

  beforeAll(async () => {
    const task = await apiClient.createTaskByIntent({
      itemId: `pause-test-${Date.now()}`,
      actionType: 'transcode',
    });
    taskId = task.id;
  });

  it('pauseTask returns paused status', async () => {
    const result = await apiClient.pauseTask(taskId);
    expect(result.id).toBe(taskId);
    // Service returns 'paused' (or the current status if already paused)
    const detail = await apiClient.getTask(taskId);
    expect(detail.status).toBe('paused');
  });

  it('executeTask resumes paused task to queued', async () => {
    const result = await apiClient.executeTask(taskId);
    expect(result.id).toBe(taskId);
    const detail = await apiClient.getTask(taskId);
    expect(detail.status).toBe('queued');
  });

  it('pauseTask non-existent throws (404)', async () => {
    await expect(apiClient.pauseTask('nonexistent-id')).rejects.toThrow(/404/);
  });

  it('executeTask non-existent throws (404)', async () => {
    await expect(apiClient.executeTask('nonexistent-id')).rejects.toThrow(/404/);
  });
});

// ── Tasks: confirm ───────────────────────────────────────────────────────────────

describe('Task confirm', () => {
  it('updateTask confirm on non-awaiting task throws (409)', async () => {
    const task = await apiClient.createTaskByIntent({
      itemId: `confirm-test-${Date.now()}`,
      actionType: 'transcode',
    });
    await expect(
      apiClient.updateTask(task.id, { confirmed: true } as any),
    ).rejects.toThrow(/409/);
  });
});

// ── Library ──────────────────────────────────────────────────────────────────────

describe('Library', () => {
  const subLibId = `int-lib-${Date.now()}`;

  beforeAll(async () => {
    // Direct cache writes are disabled after Kairox refresh cutover.
    const r = await fetch(`${SERVICE_URL}/v1/library/cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subLibraryId: subLibId,
        items: [
          { sourceId: 'src-a', name: 'Integration Test Movie', type: 'Movie', path: '/m/it.mkv', bitrate: 12000000, duration: 5400, resolution: '1920x1080', size: 6000000000, premiereDate: '2025-01-01', genres: ['Action'], isDiscLike: false },
        ],
      }),
    });
    expect(r.status).toBe(410);
  });

  it('getLibraryCache returns { items, total }', async () => {
    const result = await apiClient.getLibraryCache(subLibId);
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe('number');
  });

  it('getLibraryCache without filter returns all', async () => {
    const result = await apiClient.getLibraryCache();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('getLibraryStatus returns subLibraries array', async () => {
    const status = await apiClient.getLibraryStatus();
    expect(Array.isArray(status.subLibraries)).toBe(true);
  });

  it('patchItemRatings writes and returns ok', async () => {
    const lib = await apiClient.getLibraryCache(subLibId);
    const item = lib.items[0] as any;
    expect(item).toBeTruthy();
    const result = await apiClient.patchItemRatings(item.itemId, 4);
    expect(result.ok).toBe(true);
  });

  it('patchItemRatings missing itemId throws (400)', async () => {
    await expect(apiClient.patchItemRatings('', 3)).rejects.toThrow(/400/);
  });

  it('patchItemRatings out of range throws (400)', async () => {
    await expect(apiClient.patchItemRatings('x', 6)).rejects.toThrow(/400/);
  });

  // Queries against real Emby will 404 (no Emby server configured)
  it('getUnplayedItems without valid sublib throws', async () => {
    await expect(apiClient.getUnplayedItems('nonexistent-sublib')).rejects.toThrow(/404/);
  });

  // mark-played / mark-unplayed need Emby, test validation only
  it('markPlayed without itemId throws (400)', async () => {
    await expect(apiClient.markPlayed('')).rejects.toThrow(/400/);
  });

  it('markUnplayed without itemId throws (400)', async () => {
    await expect(apiClient.markUnplayed('')).rejects.toThrow(/400/);
  });
});

// ── Config ───────────────────────────────────────────────────────────────────────

describe('Config', () => {
  it('getConfig returns config object with known keys', async () => {
    const cfg = await apiClient.getConfig();
    expect(cfg).toBeTruthy();
    expect(cfg).toHaveProperty('executionMode');
    expect(cfg).toHaveProperty('transcodeConcurrency');
    expect(cfg).toHaveProperty('ruleTemplates');
  });

  it('patchConfig partially updates and persists', async () => {
    const updated = await apiClient.patchConfig({ transcodeConcurrency: 3 });
    expect(updated.transcodeConcurrency).toBe(3);
    // Verify persistence
    const reloaded = await apiClient.getConfig();
    expect(reloaded.transcodeConcurrency).toBe(3);
    // Restore
    await apiClient.patchConfig({ transcodeConcurrency: 1 });
  });

  it('patchConfig invalid field does not error (best-effort)', async () => {
    // Service applies partial update; unknown fields are silently stored
    const r = await apiClient.patchConfig({ nonexistentField: 'x' });
    expect(r).toBeTruthy();
  });
});
