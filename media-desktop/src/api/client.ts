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

  async updateTask(taskId: string, updates: Partial<MediaTask>): Promise<MediaTask> {
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
    const r = await fetch(url, { method: 'DELETE', headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to delete task: HTTP ${r.status}`);
  }

  async executeTask(taskId: string): Promise<{ ok: boolean; message: string }> {
    const url = `${this.getBaseUrl()}/v1/tasks/${taskId}/actions/execute`;
    const r = await fetch(url, { method: 'POST', headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to execute task: HTTP ${r.status}`);
    return r.json();
  }

  async pauseTask(taskId: string): Promise<{ ok: boolean; message: string }> {
    const url = `${this.getBaseUrl()}/v1/tasks/${taskId}/actions/pause`;
    const r = await fetch(url, { method: 'POST', headers: this.getHeaders() });
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

  async patchItemRatings(patch: Record<string, number | null>): Promise<{ ok: boolean; count: number }> {
    const url = `${this.getBaseUrl()}/v1/library/ratings`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(patch),
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

  // ── Douban ──

  async getDoubanCache(): Promise<{ entries: unknown[]; syncedAt: string | null }> {
    const url = `${this.getBaseUrl()}/v1/integrations/douban/ratings/cache`;
    const r = await fetch(url, { headers: this.getHeaders() });
    if (!r.ok) throw new Error(`Failed to get douban cache: HTTP ${r.status}`);
    return r.json();
  }
}

export const apiClient = new ApiClient();
