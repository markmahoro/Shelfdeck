import { afterEach, expect, it, vi } from 'vitest';
import { helixAdminApi } from '../src/helix/api';

afterEach(() => vi.restoreAllMocks());

it('sends seat changes through the Admin gateway with a distinct command key', async () => {
  const commands: Array<{ predeckPipelineSeats: number; idempotencyKey?: string }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(input).toBe('/v1/admin/libra/material-fields/source-a/intake-admission');
    expect(init?.method).toBe('PATCH');
    const body = JSON.parse(String(init?.body));
    commands.push(body);
    // Match the real Admin HTTP adapter's mandatory command boundary.
    if (!body.idempotencyKey) return new Response(JSON.stringify({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'IDEMPOTENCY_KEY_REQUIRED' } }), { status: 400 });
    return new Response(JSON.stringify({ fieldId: 'source-a', predeckPipelineSeats: body.predeckPipelineSeats }), { status: 200 });
  });
  expect((await helixAdminApi.patchFieldIntakeAdmission('source-a', { predeckPipelineSeats: 0 })).predeckPipelineSeats).toBe(0);
  expect((await helixAdminApi.patchFieldIntakeAdmission('source-a', { predeckPipelineSeats: 2 })).predeckPipelineSeats).toBe(2);
  expect(commands[0].idempotencyKey).toBeTruthy();
  expect(commands[1].idempotencyKey).not.toBe(commands[0].idempotencyKey);
});
