import { describe, expect, it } from 'vitest';
import { materialFieldRegistration } from '../src/helix/api';

describe('Material Field physical access identity', () => {
  it('leaves physical identity resolution to the Platform registration boundary', async () => {
    const first:any = await materialFieldRegistration({ fieldId:'field-a', name:'A',
      rootLocation:'F:\\shelfdeck_test_zone\\canary', includedDirectories:[], excludedDirectories:[] });
    const second:any = await materialFieldRegistration({ fieldId:'field-b', name:'B',
      rootLocation:'f:/shelfdeck_test_zone/canary/', includedDirectories:[], excludedDirectories:[] });
    expect(first.fieldId).not.toBe(second.fieldId);
    expect(first.access.rootLocation).toBe('F:\\shelfdeck_test_zone\\canary');
    expect(second.access.rootLocation).toBe('f:/shelfdeck_test_zone/canary/');
    for (const access of [first.access, second.access]) {
      expect(access.endpointId).toBeUndefined();
      expect(access.mountScopeId).toBeUndefined();
      expect(access.mountScopeRevision).toBeUndefined();
      expect(access.accessDigest).toBeUndefined();
    }
  });
});
