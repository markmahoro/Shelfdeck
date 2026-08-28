import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalDigest } from '../src/helix/api';
import { sha256Hex } from '../src/helix/sha256';

describe('sha256Hex', () => {
  it('matches FIPS 180-4 empty and abc vectors', () => {
    expect(sha256Hex(new TextEncoder().encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('canonicalDigest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('computes policy digests when crypto.subtle is missing on HTTP LAN', async () => {
    vi.stubGlobal('crypto', {});
    await expect(canonicalDigest({ a: 1 })).resolves.toBe(
      '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
    );
  });
});
