import {fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {JavRuleSummary,JavRuleEditor,javEditFromRules,applyJavEdit} from '../src/helix/JavRuleSettings';
import {namingExamples} from '../src/helix/ShelvesPage';
import type {RuleTemplateRules,ShelfPlacementPolicy} from '../src/helix/api';
const require=createRequire(import.meta.url),owner=require('../../src/helix/domains/arca/model/rule-template-contracts'),
  {canonicalDigest}=require('../../src/helix/contracts/canonical-json'),rules:RuleTemplateRules=owner.JAV_RECOMMENDED_RULES;
afterEach(()=>vi.unstubAllGlobals());
it('displays the real static JAV media, size and material requirements without rating branches',()=>{
  render(<JavRuleSummary rules={rules}/>);expect(screen.getByRole('region',{name:'JAV整理标准'})).toBeVisible();
  expect(screen.getByText('HEVC · Matroska (.mkv)')).toBeVisible();expect(screen.getByText('最多 2 GiB')).toBeVisible();
  expect(screen.getByText('必需资料：标题')).toBeVisible();expect(screen.getByText('背景图、NFO、海报')).toBeVisible();expect(screen.queryByText('未评分')).not.toBeInTheDocument();
});
it('edits static requirements while conserving identity, metadata and empty decision branches under the actual Owner validator',async()=>{
  vi.stubGlobal('crypto',webcrypto);const edit=javEditFromRules(rules)!,before=canonicalDigest(rules),onChange=vi.fn();
  render(<JavRuleEditor edit={edit} onChange={onChange}/>);fireEvent.change(screen.getByLabelText('每部空间上限 GiB'),{target:{value:'1.5'}});
  expect(onChange).toHaveBeenCalledWith({...edit,maxSizeGiB:'1.5'});
  const changed=await applyJavEdit(rules,{...edit,maxSizeGiB:'1.5'});
  expect(owner.validateRuleTemplateRules(owner.RULES_SCHEMA_REF,changed,canonicalDigest(changed))).toBeTruthy();
  expect(changed.profileRuleSets[0].decisionBranches).toEqual([]);expect(changed.profileRuleSets[0].decisionInputKinds).toEqual([]);
  expect(changed.profileRuleSets[0].baseRequirements).toMatchObject({space:{maxSizeGiB:1.5,maxSizeBytes:1610612736},metadata:{requiredFieldCodes:['title']}});
  expect(canonicalDigest(rules)).toBe(before);await expect(applyJavEdit(rules,{...edit,maxSizeGiB:'-1'})).rejects.toThrow('每部空间上限');
});
it('has a JAV naming example without Season or Episode placeholders',()=>{
  const placement={folderTemplate:'{title} ({year})',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'} as ShelfPlacementPolicy,
    preview=namingExamples(placement,'jav');expect(preview.directory).toContain('JAV');expect(preview.names.some(name=>name.endsWith('.mkv'))).toBe(true);
  expect(JSON.stringify(preview)).not.toMatch(/Season|S01E01|season\.nfo/);
});
