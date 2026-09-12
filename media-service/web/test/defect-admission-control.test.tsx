import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DefectAdmissionControl} from '../src/helix/DefectAdmissionControl';
import {AdminApiError,helixAdminApi,type DefectAdmissionPreview,type FormationSubject} from '../src/helix/api';

const item={currentRun:{libraRunId:'run',stateRevision:1,stateDigest:'digest'}} as FormationSubject;
afterEach(()=>vi.restoreAllMocks());

it('UAT-251 exposes a failed preview and allows a new read before any admission',async()=>{
  const preview=vi.spyOn(helixAdminApi,'previewDefectAdmission')
    .mockRejectedValueOnce(new AdminApiError(503,'SERVICE_UNAVAILABLE','unavailable'))
    .mockResolvedValueOnce({candidateDigest:'candidate',eligibility:'eligible'} as DefectAdmissionPreview);
  const admit=vi.fn();render(<DefectAdmissionControl item={item} disabled={false} onAdmit={admit}/>);
  expect(await screen.findByText('暂时无法确认瑕疵接纳条件')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'接受瑕疵'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'重新检查'}));
  fireEvent.click(await screen.findByRole('button',{name:'接受瑕疵'}));
  expect(preview).toHaveBeenCalledTimes(2);expect(admit).toHaveBeenCalledTimes(1);
});

it('UAT-251 distinguishes a definitive ineligible result from a request failure',async()=>{
  vi.spyOn(helixAdminApi,'previewDefectAdmission').mockResolvedValue({eligibility:'ineligible',message:'当前证据不支持瑕疵上架',ineligibleReasons:['identity_unmet'],missingEvidence:[]});
  render(<DefectAdmissionControl item={item} disabled={false} onAdmit={vi.fn()}/>);
  expect(await screen.findByText('当前证据不支持瑕疵上架')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('UAT-251 ignores a stale eligible preview after the Run revision changes',async()=>{
  let finish:(value:DefectAdmissionPreview)=>void=()=>{};
  const preview=vi.spyOn(helixAdminApi,'previewDefectAdmission')
    .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}))
    .mockResolvedValueOnce({eligibility:'ineligible',message:'当前证据不支持瑕疵上架',ineligibleReasons:['identity_unmet'],missingEvidence:[]});
  const view=render(<DefectAdmissionControl item={item} disabled={false} onAdmit={vi.fn()}/>);
  view.rerender(<DefectAdmissionControl item={{...item,currentRun:{...item.currentRun!,stateRevision:2}}} disabled={false} onAdmit={vi.fn()}/>);
  await screen.findByText('当前证据不支持瑕疵上架');
  finish({candidateDigest:'old',eligibility:'eligible'} as DefectAdmissionPreview);
  await waitFor(()=>expect(preview).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button',{name:'接受瑕疵'})).not.toBeInTheDocument();
});

it('UAT-251 keeps missing evidence distinct and does not authorize it',async()=>{
  vi.spyOn(helixAdminApi,'previewDefectAdmission').mockResolvedValue({eligibility:'evidence_pending',message:'尚缺少成品播放证据。',missingEvidence:['playback'],ineligibleReasons:[]});
  const admit=vi.fn();render(<DefectAdmissionControl item={item} disabled={false} onAdmit={admit}/>);
  expect(await screen.findByText('尚缺少成品播放证据。')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'接受瑕疵'})).toBeNull();
  expect(screen.getByRole('button',{name:'重新检查'})).toBeTruthy();expect(admit).not.toHaveBeenCalled();
});
