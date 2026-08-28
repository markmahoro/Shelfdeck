import { afterEach, describe, expect, it, vi } from 'vitest';
import { newOpaqueId } from '../src/helix/id';

describe('newOpaqueId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('works when randomUUID is unavailable, as on HTTP LAN Admin Web', () => {
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i + 1;
        return bytes;
      },
    });
    const id = newOpaqueId('movie-field-');
    expect(id.startsWith('movie-field-')).toBe(true);
    expect(id).toMatch(/^movie-field-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
