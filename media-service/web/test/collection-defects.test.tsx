import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import CollectionDefects from '../src/helix/CollectionDefects';
import {helixAdminApi,type CollectionDefectPreview} from '../src/helix/api';
const expire=()=>{};
vi.mock('../src/helix/session',()=>({useSession:()=>({expire}),isUnauthorized:()=>false}));
const actor={gapDigest:'actor',findingKind:'conformance:metadata_field_missing__actor',requirementCode:'metadata_field_unmet',targetKind:'metadata_field' as const,targetId:'actor',requiredValue:{field:'actor'}};
const poster={gapDigest:'poster',findingKind:'presentation:poster_missing',requirementCode:'artifact_unmet',targetKind:'artifact' as const,targetId:'poster',requiredValue:{artifact:'poster'}};
const preview=(accepted=false):CollectionDefectPreview=>({shelfEntryId:'entry',inventoryRevision:4,careBasisDigest:'basis',authorizationRevision:2,
  candidateDigest:'candidate',gapSetDigest:'gaps',gaps:[actor,poster],acceptedGaps:accepted?[actor,poster]:[],eligibility:'eligible',missingEvidence:[],ineligibleReasons:[],
  repairableGapDigests:accepted?['poster']:[],unavailableRepairs:accepted?[{findingKind:actor.findingKind,reasonCode:'no_current_bounded_repair_path'}]:[]});
beforeEach(()=>{
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});
afterEach(()=>vi.restoreAllMocks());

it('separates failed reads from missing evidence and never submits a command while retrying the preview',async()=>{
  vi.spyOn(helixAdminApi,'previewCollectionDefects').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({...preview(),eligibility:'evidence_pending',missingEvidence:['current_health_assessment']});
  const mutate=vi.spyOn(helixAdminApi,'decideCollectionDefects');
  render(<CollectionDefects shelfEntryId="entry" revision="1" onChanged={()=>{}}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
  fireEvent.click(screen.getByRole('button',{name:'重新读取'}));
  expect(await screen.findByText(/需要一次完整的健康检查/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'接受当前瑕疵'})).toBeNull();expect(mutate).not.toHaveBeenCalled();
});

it('requires exact confirmation, cancellation has no effect, and stale rejection stays visible',async()=>{
  vi.spyOn(helixAdminApi,'previewCollectionDefects').mockResolvedValue(preview());
  const mutate=vi.spyOn(helixAdminApi,'decideCollectionDefects').mockRejectedValue(new Error('stale'));
  render(<CollectionDefects shelfEntryId="entry" revision="1" onChanged={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'接受当前瑕疵'}));
  expect(screen.getByRole('dialog')).toHaveTextContent('演员资料缺失');
  fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'接受当前瑕疵'}));fireEvent.click(screen.getByRole('button',{name:'确认接受'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('重新读取');
  expect(mutate).toHaveBeenCalledWith(preview(),'accept-defects',expect.any(String));
  expect(screen.getByRole('button',{name:'确认接受'})).toBeDisabled();
});

it('manual repair confirms only currently executable gaps and leaves unsupported accepted gaps visible',async()=>{
  vi.spyOn(helixAdminApi,'previewCollectionDefects').mockResolvedValue(preview(true));
  const mutate=vi.spyOn(helixAdminApi,'decideCollectionDefects').mockResolvedValue({resultKind:'repair_requested',aftercareCaseId:'case'});
  const changed=vi.fn();render(<CollectionDefects shelfEntryId="entry" revision="1" onChanged={changed}/>);
  fireEvent.click(await screen.findByRole('button',{name:'手动修复已接受瑕疵'}));
  const dialog=screen.getByRole('dialog');expect(within(dialog).getByText('海报缺失')).toBeTruthy();
  expect(within(dialog).queryByText('演员资料缺失')).toBeNull();expect(dialog).toHaveTextContent('失败时保留原片和瑕疵');
  expect(mutate).not.toHaveBeenCalled();fireEvent.click(within(dialog).getByRole('button',{name:'提交手动修复'}));
  await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText(/演员资料缺失/)).toHaveTextContent('暂不可修复');
  expect(screen.getByText(/海报缺失/)).not.toHaveTextContent('暂不可修复');
});

it('identifies the Movie-only eligibility boundary without claiming file damage',async()=>{
  vi.spyOn(helixAdminApi,'previewCollectionDefects').mockResolvedValue({...preview(),gaps:[],eligibility:'ineligible',ineligibleReasons:['movie_only']});
  render(<CollectionDefects shelfEntryId="entry" revision="1" onChanged={()=>{}}/>);
  expect(await screen.findByText('当前仅支持为电影接受瑕疵。')).toBeInTheDocument();
  expect(screen.queryByText(/文件安全或完整性问题/)).toBeNull();
  expect(screen.queryByRole('button',{name:'接受当前瑕疵'})).toBeNull();
});
