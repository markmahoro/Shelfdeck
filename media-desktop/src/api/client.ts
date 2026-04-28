/**
 * [API_CLIENT] 类型化 REST 客户端。
 *
 * 全局单例。每次调用动态从 CONNECTION 模块读取 baseUrl + apiKey。
 */

import { getBaseUrl, getApiKey } from '../connection/baseUrl';
import type { MediaTask } from '../models/task';

export class ApiConflictError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiConflictError';
  }
}

class ApiClient {
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = getApiKey();
    if (apiKey) headers['X-API-Key'] = apiKey;
    return headers;
  }

  /** Headers without Content-Type — for bodyless POST/DELETE (Fastify rejects empty JSON body). */
  private getHeadersNoBody(): Record<string, string> {
    const headers: Record<string, string> = {};
    const apiKey = getApiKey();
    if (apiKey) headers['X-API-Key'] = apiKey;
    return headers;
  }

  private getBaseUrl(): string {
    const base = getBaseUrl();
    if (!base) throw new Error('Media service base URL not configured');
    return String(base).replace(/\/$/, '');
  }

  // ── Task ──

  async getTasks(filter?: { status?: string; actionType?: string; itemId?: string }): Promise<MediaTask[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.actionType) params.set('actionType', filter.actionType);
    if (filter?.itemId) params.set('itemId', filter.itemId);
    const query = params.toString();
    const url = `${this.getBaseUrl()}/v1/tasks${query ? `?${query}` : ''}`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to get tasks: HTTP ${r.status}`);
    const data = await r.json();
    return Array.isArray(data) ? data : (data as { tasks: MediaTask[] }).tasks ?? [];
  }

  async createTaskByIntent(intent: { itemId: string; actionType: string }): Promise<MediaTask> {
    const url = `${this.getBaseUrl()}/v1/tasks`;
    const r = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(intent),
    });
    if (r.status === 409) {
      const body = await r.json().catch(() => ({}));
      throw new ApiConflictError(body.code || 'CONFLICT', body.message || 'Conflict');
    }
    if (!r.ok) throw new Error(`Failed to create task: HTTP ${r.status}`);
    return r.json();
  }

  async getTask(taskId: string): Promise<MediaTask> {
    const url = `${this.getBaseUrl()}/v1/tasks/${taskId}`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to get task: HTTP ${r.status}`);
    return r.json();
  }

  async updateTask(taskId: string, updates: Record<string, unknown>): Promise<MediaTask> {
    const url = `${this.getBaseUrl()}/v1/tasks/${taskId}`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error(`Failed to update task: HTTP ${r.status}`);
    return r.json();
  }

  async deleteTask(taskId: string): Promise<void> {
    const url = `${this.getBaseUrl()}/v1/tasks/${taskId}`;
    const r = await fetch(url, { method: 'DELETE', headers: this.getHeadersNoBody() });
    if (!r.ok) throw new Error(`Failed to delete task: HTTP ${r.status}`);
  }

  async executeTask(taskId: string): Promise<{ ok: boolean; message: string }> {
    const url = `${this.getBaseUrl()}/v1/tasks/${taskId}/actions/execute`;
    const r = await fetch(url, { method: 'POST', headers: this.getHeadersNoBody() });
    if (!r.ok) throw new Error(`Failed to execute task: HTTP ${r.status}`);
    return r.json();
  }

  async pauseTask(taskId: string): Promise<{ ok: boolean; message: string }> {
    const url = `${this.getBaseUrl()}/v1/tasks/${taskId}/actions/pause`;
    const r = await fetch(url, { method: 'POST', headers: this.getHeadersNoBody() });
    if (!r.ok) throw new Error(`Failed to pause task: HTTP ${r.status}`);
    return r.json();
  }

  // ── Library ──

  async getLibraryCache(subLibraryId?: string): Promise<{ items: unknown[]; total: number }> {
    const params = new URLSearchParams();
    if (subLibraryId) params.set('subLibraryId', subLibraryId);
    const query = params.toString();
    const url = `${this.getBaseUrl()}/v1/library${query ? `?${query}` : ''}`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to get library: HTTP ${r.status}`);
    return r.json();
  }

  async setLibraryCache(items: unknown[]): Promise<{ items: unknown[]; cachedAt: string }> {
    const url = `${this.getBaseUrl()}/v1/library/cache`;
    const r = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ items }),
    });
    if (!r.ok) throw new Error(`Failed to set library cache: HTTP ${r.status}`);
    return r.json();
  }

  async getItemRatings(): Promise<Record<string, { rating: number; updatedAt: string }>> {
    const url = `${this.getBaseUrl()}/v1/library/ratings`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to get ratings: HTTP ${r.status}`);
    return r.json();
  }

  async patchItemRatings(itemId: string, userRating: number | null): Promise<{ ok: boolean }> {
    const url = `${this.getBaseUrl()}/v1/library/ratings`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ itemId, userRating }),
    });
    if (!r.ok) throw new Error(`Failed to patch ratings: HTTP ${r.status}`);
    return r.json();
  }

  // ── Config ──

  async getConfig(): Promise<Record<string, unknown>> {
    const url = `${this.getBaseUrl()}/v1/config`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to get config: HTTP ${r.status}`);
    return r.json();
  }

  async patchConfig(updates: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.getBaseUrl()}/v1/config`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(updates),
    });
    if (!r.ok) throw new Error(`Failed to patch config: HTTP ${r.status}`);
    return r.json();
  }

  async getLibraryStatus(): Promise<{ subLibraries: { uuid: string; name: string; enabled: boolean }[] }> {
    const url = `${this.getBaseUrl()}/v1/library/status`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to get library status: HTTP ${r.status}`);
    return r.json();
  }

  // ── Library: mark played / unplayed ──

  async markPlayed(itemId: string, subLibraryId?: string): Promise<{ ok: boolean }> {
    const url = `${this.getBaseUrl()}/v1/library/actions/mark-played`;
    const r = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ itemId, subLibraryId: subLibraryId || undefined }),
    });
    if (!r.ok) throw new Error(`Failed to mark played: HTTP ${r.status}`);
    return r.json();
  }

  async markUnplayed(itemId: string, subLibraryId?: string): Promise<{ ok: boolean }> {
    const url = `${this.getBaseUrl()}/v1/library/actions/mark-unplayed`;
    const r = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ itemId, subLibraryId: subLibraryId || undefined }),
    });
    if (!r.ok) throw new Error(`Failed to mark unplayed: HTTP ${r.status}`);
    return r.json();
  }

  // ── Playback log (local operation record) ──

  async getPlaybackLog(subLibraryId?: string): Promise<PlaybackLogEntry[]> {
    const params = subLibraryId ? `?subLibraryId=${encodeURIComponent(subLibraryId)}` : '';
    const url = `${this.getBaseUrl()}/v1/library/playback-log${params}`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to get playback log: HTTP ${r.status}`);
    return r.json();
  }

  async getUnplayedItems(subLibraryId: string, sectionId?: string): Promise<UnplayedItem[]> {
    const url = `${this.getBaseUrl()}/v1/library/queries/unplayed`;
    const r = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ subLibraryId: subLibraryId || undefined, sectionId }),
    });
    if (!r.ok) throw new Error(`Failed to get unplayed items: HTTP ${r.status}`);
    return r.json();
  }

  // ── Douban ──

  async getDoubanCache(): Promise<{ entries: unknown[]; syncedAt: string | null }> {
    const url = `${this.getBaseUrl()}/v1/integrations/douban/ratings/cache`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to get douban cache: HTTP ${r.status}`);
    return r.json();
  }

  // ── Activity Log ──

  async getActivityLog(limit?: number): Promise<ActivityEntry[]> {
    const url = `${this.getBaseUrl()}/v1/activity-log?limit=${limit || 5}`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) return [];
    const data = await r.json();
    return (data as { entries: ActivityEntry[] }).entries ?? [];
  }
}

export type PlaybackLogEntry = {
  itemId: string;
  itemName: string;
  subLibraryId: string;
  type: string;
  posterUrl?: string;
  path?: string;
  embyWebUrl?: string;
  sectionName?: string;
  playedAt: string;
};

export type UnplayedItem = {
  id: string;
  name: string;
  sectionId: string;
  posterTag?: string;
  posterUrl?: string;
  embyWebUrl?: string;
  path?: string;
  runTimeTicks?: number;
  durationSec: number;
  sizeGb: number;
  resolution: '1080p' | '4K';
  codec: 'h264' | 'h265' | 'av1';
  itemType: 'Movie' | 'Episode' | 'Other';
  isBluRayDisc: boolean;
  embyPlayed: boolean;
};

export type ActivityEntry = {
  ts: string;
  source: string;
  message: string;
  detail?: Record<string, unknown>;
};

export const apiClient = new ApiClient();
