import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import DefectAdmissionDialog from '../src/helix/DefectAdmissionDialog';
import {AdminApiError,helixAdminApi,type DefectAdmissionCandidate,type FormationSubject} from '../src/helix/api';

const GiB=1073741824;
function item(id:string):FormationSubject{return {formationViewId:'view-'+id,subjectId:'subject-'+id,displayIdentity:'测试影片',contentProfile:'western_adult',
  currentRun:{libraRunId:id,state:'frozen',stateRevision:3,stateDigest:'frozen-'+id,priorityClass:'normal',packageRevisionHead:0,currentIdentityRevision:1}} as FormationSubject;}
function candidate(id:string,digest='first',measured=true):DefectAdmissionCandidate{return {candidateRevision:1,libraRunId:id,frozenRunStateRevision:3,
  frozenRunStateDigest:'frozen-'+id,terminalEvidenceDigest:'terminal',candidateDigest:digest,waivedRequirementCodes:['max_size_exceeded'],
  defects:[{defectCode:'size_cap_exceeded',sourceFailureCode:'size',waivedRequirementCodes:['max_size_exceeded']}],
  sizeForecast:{maxSizeBytes:GiB,predictedBytes:measured?9*GiB:1.5*GiB,overshootBytes:0.5*GiB,
    ...(measured?{measured:true,actualSizeBytes:1.5*GiB,withinLimit:false}:{})}} as DefectAdmissionCandidate;}
function mount(id:string,options:{onClose?:()=>void;onComplete?:()=>Promise<void>}={}){
  const onClose=options.onClose||vi.fn(),onComplete=options.onComplete||vi.fn().mockResolvedValue(undefined);
  const view=render(<DefectAdmissionDialog item={item(id)} candidate={candidate(id)} onClose={onClose} onComplete={onComplete} onUnauthorized={vi.fn()}/>);
  return {...view,onClose,onComplete,dialog:screen.getByRole('dialog',{name:'确认接受瑕疵入库'})};
}
afterEach(()=>vi.restoreAllMocks());

it('uses the measured actual size and only the native ordered-list marker',()=>{
  const {dialog}=mount('measured');const entry=within(dialog).getByRole('listitem');
  expect(entry).toHaveTextContent('上限 1.0 GiB');expect(entry).toHaveTextContent('实际 1.5 GiB');
  expect(entry).toHaveTextContent('超出 0.5 GiB');expect(entry).not.toHaveTextContent('预计');
  expect(entry).not.toHaveTextContent('9.0 GiB');expect(entry.textContent).not.toMatch(/^\s*1\.\s/);
  expect(dialog).toHaveTextContent('保留瑕疵记录');
});

it('only calls a value a forecast when no measured value is reported',()=>{
  render(<DefectAdmissionDialog item={item('forecast')} candidate={candidate('forecast','first',false)} onClose={vi.fn()} onComplete={async()=>{}} onUnauthorized={vi.fn()}/>);
  const entry=within(screen.getByRole('dialog')).getByRole('listitem');
  expect(entry).toHaveTextContent('预计 1.5 GiB');expect(entry).not.toHaveTextContent('实际');
});

it('shows a definite stale error in the dialog and requires a new preview before a fresh confirmation',async()=>{
  const subject=item('stale'),first=candidate('stale'),second=candidate('stale','second');
  const post=vi.spyOn(helixAdminApi,'admitWithDefects').mockRejectedValueOnce(new AdminApiError(409,'P9_DEFECT_ADMISSION_EVIDENCE_PENDING','成品证据已变化，请重新核对。'))
    .mockResolvedValueOnce({resultKind:'defect_admitted',libraRunId:'stale',replayed:false});
  vi.spyOn(helixAdminApi,'getFormation').mockResolvedValue(subject);
  const preview=vi.spyOn(helixAdminApi,'previewDefectAdmission').mockResolvedValue({...second,eligibility:'eligible'});
  const {dialog,onComplete}=mount('stale');
  fireEvent.click(within(dialog).getByRole('button',{name:'确认接受'}));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('证据');
  expect(within(dialog).getByRole('button',{name:'确认接受'})).toBeDisabled();
  expect(post).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole('button',{name:'重新检查'}));
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'确认接受'})).toBeEnabled());
  expect(preview).toHaveBeenCalledWith(subject);expect(post).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole('button',{name:'确认接受'}));
  await waitFor(()=>expect(onComplete).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][1]).toEqual(first);expect(post.mock.calls[1][1]).toEqual({...second,eligibility:'eligible'});
  expect(post.mock.calls[0][2]).not.toEqual(post.mock.calls[1][2]);
});

it('keeps a stale confirmation disabled when a fresh preview is pending or ineligible',async()=>{
  const subject=item('pending'),post=vi.spyOn(helixAdminApi,'admitWithDefects')
    .mockRejectedValueOnce(new AdminApiError(409,'LIBRA_DEFECT_ADMISSION_CANDIDATE_STALE','changed'));
  vi.spyOn(helixAdminApi,'getFormation').mockResolvedValue(subject);
  vi.spyOn(helixAdminApi,'previewDefectAdmission').mockResolvedValueOnce({eligibility:'evidence_pending',message:'尚缺少成品证据。',missingEvidence:[],ineligibleReasons:[]})
    .mockResolvedValueOnce({eligibility:'ineligible',message:'当前成品不可接纳。',missingEvidence:[],ineligibleReasons:['identity']});
  const {dialog}=mount('pending');fireEvent.click(within(dialog).getByRole('button',{name:'确认接受'}));
  await within(dialog).findByRole('alert');fireEvent.click(within(dialog).getByRole('button',{name:'重新检查'}));
  expect(await within(dialog).findByText('尚缺少成品证据。')).toBeInTheDocument();
  expect(within(dialog).getByRole('button',{name:'确认接受'})).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button',{name:'重新检查'}));
  expect(await within(dialog).findByText('当前成品不可接纳。')).toBeInTheDocument();
  expect(within(dialog).getByRole('button',{name:'确认接受'})).toBeDisabled();expect(post).toHaveBeenCalledTimes(1);
});

it('keeps an uncertain command and reconciles only the same idempotency key after reopening',async()=>{
  const post=vi.spyOn(helixAdminApi,'admitWithDefects').mockRejectedValueOnce(new TypeError('response lost'))
    .mockResolvedValueOnce({resultKind:'defect_admitted',libraRunId:'uncertain',replayed:true});
  const first=mount('uncertain');fireEvent.click(within(first.dialog).getByRole('button',{name:'确认接受'}));
  expect(await within(first.dialog).findByRole('alert')).toHaveTextContent('尚未确认');
  expect(within(first.dialog).getByRole('button',{name:'确认接受'})).toBeDisabled();
  expect(within(first.dialog).queryByRole('button',{name:'重新检查'})).toBeNull();
  first.unmount();const second=mount('uncertain');
  fireEvent.click(within(second.dialog).getByRole('button',{name:'确认提交结果'}));
  await waitFor(()=>expect(second.onComplete).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledTimes(2);expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
  expect(typeof post.mock.calls[0][2]).toBe('string');
});

it('a successful command with failed refresh only offers a status refresh, never another command',async()=>{
  const post=vi.spyOn(helixAdminApi,'admitWithDefects').mockResolvedValue({resultKind:'defect_admitted',libraRunId:'refresh',replayed:false});
  const onComplete=vi.fn().mockRejectedValueOnce(new Error('GET failed')).mockResolvedValueOnce(undefined);
  const {dialog}=mount('refresh',{onComplete});fireEvent.click(within(dialog).getByRole('button',{name:'确认接受'}));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('状态读取失败');
  fireEvent.click(within(dialog).getByRole('button',{name:'刷新状态'}));
  await waitFor(()=>expect(onComplete).toHaveBeenCalledTimes(2));expect(post).toHaveBeenCalledTimes(1);
});

it('does not substitute the predicted value when measured size is missing',()=>{
  const incomplete=candidate('missing-actual');delete incomplete.sizeForecast!.actualSizeBytes;
  render(<DefectAdmissionDialog item={item('missing-actual')} candidate={incomplete} onClose={vi.fn()} onComplete={async()=>{}} onUnauthorized={vi.fn()}/>);
  const entry=within(screen.getByRole('dialog')).getByRole('listitem');
  expect(entry).toHaveTextContent('实际体积暂不可用');expect(entry).not.toHaveTextContent('9.0 GiB');expect(entry).not.toHaveTextContent('预计');
});

it('does not treat a later conflict as proof that an uncertain earlier command failed',async()=>{
  const post=vi.spyOn(helixAdminApi,'admitWithDefects').mockRejectedValueOnce(new TypeError('response lost'))
    .mockRejectedValueOnce(new AdminApiError(409,'LIBRA_DEFECT_ADMISSION_STATE','state changed'));
  const {dialog}=mount('uncertain-conflict');fireEvent.click(within(dialog).getByRole('button',{name:'确认接受'}));
  await within(dialog).findByRole('alert');fireEvent.click(within(dialog).getByRole('button',{name:'确认提交结果'}));
  await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('尚未确认');
  expect(within(dialog).queryByRole('button',{name:'重新检查'})).toBeNull();
  expect(within(dialog).getByRole('button',{name:'确认接受'})).toBeDisabled();
  expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
});
