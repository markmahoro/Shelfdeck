import { createRequire } from 'node:module';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ShelvesPage, { applyProfileEdits } from '../src/helix/ShelvesPage';
import { canonicalDigest, helixAdminApi, type RuleTemplateRules } from '../src/helix/api';

const require = createRequire(import.meta.url);
const { BETA_RECOMMENDED_RULES, RULES_SCHEMA_REF, validateRuleTemplateRules } = require('../../src/helix/domains/arca/model/rule-template-contracts.js');
const { expire } = vi.hoisted(() => ({ expire: vi.fn() }));
vi.mock('../src/helix/session', () => ({ useSession: () => ({ expire }), isUnauthorized: () => false }));
vi.mock('../src/helix/InputSettlementAuthorization', () => ({ default: () => null }));
vi.mock('../src/helix/DefectAuthorization', () => ({ default: () => null }));
afterEach(() => vi.restoreAllMocks());

function edits(rules: RuleTemplateRules) {
  return rules.profileRuleSets.find(p => p.contentProfile === 'series')!.decisionBranches.map(b => ({
    conditionKind: b.conditionKind, rating: b.rating,
    hevc: b.requirements.mandatoryMedia.videoCodec === 'hevc',
    fourK: b.requirements.mandatoryMedia.minimumRasterClass === '4k',
    highQualityAudio: b.requirements.mandatoryMedia.acceptedPrimaryAudioClasses.length > 0,
    maxSizeGiB: b.requirements.space.maxSizeGiB === null ? '' : String(b.requirements.space.maxSizeGiB),
  }));
}

it('changes only the Series limit and remains valid under the formal Arca contract', async () => {
  const rules = structuredClone(BETA_RECOMMENDED_RULES) as RuleTemplateRules;
  const series = rules.profileRuleSets.find(p => p.contentProfile === 'series')!;
  series.decisionBranches[1].requirements.mandatoryMedia.acceptedPrimaryAudioClasses = ['truehd'];
  const draft = edits(rules); draft[1].maxSizeGiB = '0.5';
  const updated = await applyProfileEdits(rules, draft, 'series');
  expect(updated.profileRuleSets.filter(p => p.contentProfile !== 'series')).toEqual(rules.profileRuleSets.filter(p => p.contentProfile !== 'series'));
  const branch = updated.profileRuleSets.find(p => p.contentProfile === 'series')!.decisionBranches[1];
  expect(branch.requirements.space).toEqual({ unit: 'episode', maxSizeGiB: 0.5, maxSizeBytes: 536870912 });
  expect(branch.requirements.mandatoryMedia.acceptedPrimaryAudioClasses).toEqual(['truehd']);
  expect(() => validateRuleTemplateRules(RULES_SCHEMA_REF, updated, null)).toThrow();
  const digest = await canonicalDigest(updated as never);
  expect(() => validateRuleTemplateRules(RULES_SCHEMA_REF, updated, digest)).not.toThrow();
  expect(series.decisionBranches[1].requirements.space.maxSizeGiB).toBe(0.75);
});

it.each(['0', '-1', 'NaN', '0.1', '999999999999'])('rejects invalid Series limit %s before submission', async value => {
  const draft = edits(BETA_RECOMMENDED_RULES); draft[1].maxSizeGiB = value;
  await expect(applyProfileEdits(BETA_RECOMMENDED_RULES, draft, 'series')).rejects.toThrow();
});

it('keeps profile edits while switching and sends both profiles through preview and publication', async () => {
  const rules = structuredClone(BETA_RECOMMENDED_RULES);
  const template: any = { templateId: 'system-beta-recommended', name: 'System', ownerKind: 'system', status: 'active', currentRevision: 1, current: { revision: 1, rules, rulesDigest: 'initial' } };
  const copied: any = { ...template, templateId: 'own', ownerKind: 'user' };
  const draft: any = { templateId: 'own', draftRevision: 1, basePublishedRevision: 1, rulesSchemaRef: RULES_SCHEMA_REF, rules, rulesDigest: 'initial' };
  vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
  vi.spyOn(helixAdminApi, 'listRuleTemplates').mockResolvedValue({ items: [template, copied] });
  vi.spyOn(helixAdminApi, 'copyRuleTemplate').mockResolvedValue({ template: copied, draft, replayed: false });
  vi.spyOn(helixAdminApi, 'getRuleTemplateDraft').mockResolvedValue({ templateId: 'own', writable: true, reasonCode: null, draft });
  const revise = vi.spyOn(helixAdminApi, 'reviseRuleTemplateDraft').mockImplementation(async (_, next) => ({ ...draft, draftRevision: 2, rules: next }));
  vi.spyOn(helixAdminApi, 'previewRuleTemplate').mockResolvedValue({ templateId: 'own', affectedShelfCount: 0, currentEntryPotentialGapCount: 0 } as any);
  const publish = vi.spyOn(helixAdminApi, 'publishRuleTemplate').mockResolvedValue({ template: copied, affectedShelfCount: 0, replayed: false });
  render(<ShelvesPage />);
  expect(await screen.findByRole('region', { name: '剧集整理标准' })).toHaveTextContent('每集 · 最多 0.75 GiB');
  fireEvent.click(screen.getByRole('button', { name: '复制模板' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('媒体类型'), { target: { value: 'series' } });
  fireEvent.change(dialog.getAllByLabelText('每集空间上限 GiB')[1], { target: { value: '0.5' } });
  fireEvent.change(dialog.getByLabelText('媒体类型'), { target: { value: 'movie' } });
  expect(dialog.getAllByLabelText('空间上限 GiB')[1]).toHaveValue(2);
  fireEvent.change(dialog.getByLabelText('媒体类型'), { target: { value: 'series' } });
  expect(dialog.getAllByLabelText('每集空间上限 GiB')[1]).toHaveValue(0.5);
  fireEvent.click(dialog.getByRole('button', { name: '预览影响' }));
  await waitFor(() => expect(dialog.getByRole('button', { name: '发布整理标准' })).toBeEnabled());
  const submitted = revise.mock.calls[0][1];
  expect(submitted.profileRuleSets.find(p => p.contentProfile === 'series')!.decisionBranches[1].requirements.space.maxSizeGiB).toBe(0.5);
  expect(submitted.profileRuleSets.find(p => p.contentProfile === 'movie')).toEqual(rules.profileRuleSets.find((p: any) => p.contentProfile === 'movie'));
  fireEvent.click(dialog.getByRole('button', { name: '发布整理标准' }));
  await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('status')).toHaveTextContent('整理标准已发布');
});
