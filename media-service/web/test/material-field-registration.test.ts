import { describe, expect, it } from 'vitest';
import { materialFieldRegistration } from '../src/helix/api';

describe('Material Field physical access identity', () => {
  it('uses one physical scope for two Field registrations of the same Windows root', async () => {
    const first:any = await materialFieldRegistration({ fieldId:'field-a', name:'A',
      rootLocation:'F:\\shelfdeck_test_zone\\canary', includedDirectories:[], excludedDirectories:[] });
    const second:any = await materialFieldRegistration({ fieldId:'field-b', name:'B',
      rootLocation:'f:/shelfdeck_test_zone/canary/', includedDirectories:[], excludedDirectories:[] });
    expect(first.fieldId).not.toBe(second.fieldId);
    expect(first.access.endpointId).toBe(second.access.endpointId);
    expect(first.access.mountScopeId).toBe(second.access.mountScopeId);
    expect(first.access.accessDigest).not.toBe(second.access.accessDigest);
  });
});
