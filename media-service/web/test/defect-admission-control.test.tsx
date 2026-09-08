import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DefectAdmissionControl} from '../src/helix/DefectAdmissionControl';
import {AdminApiError,helixAdminApi,type DefectAdmissionCandidate,type FormationSubject} from '../src/helix/api';

const item={currentRun:{libraRunId:'run',stateRevision:1,stateDigest:'digest'}} as FormationSubject;
afterEach(()=>vi.restoreAllMocks());

it('UAT-251 exposes a failed preview and allows a new read before any admission',async()=>{
  const preview=vi.spyOn(helixAdminApi,'previewDefectAdmission')
    .mockRejectedValueOnce(new AdminApiError(503,'SERVICE_UNAVAILABLE','unavailable'))
    .mockResolvedValueOnce({candidateDigest:'candidate'} as DefectAdmissionCandidate);
  const admit=vi.fn();render(<DefectAdmissionControl item={item} disabled={false} onAdmit={admit}/>);
  expect(await screen.findByText('暂时无法确认瑕疵接纳条件')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'接受瑕疵'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'重新检查'}));
  fireEvent.click(await screen.findByRole('button',{name:'接受瑕疵'}));
  expect(preview).toHaveBeenCalledTimes(2);expect(admit).toHaveBeenCalledTimes(1);
});

it('UAT-251 distinguishes a definitive ineligible result from a request failure',async()=>{
  vi.spyOn(helixAdminApi,'previewDefectAdmission').mockRejectedValue(new AdminApiError(409,'P9_DEFECT_ADMISSION_INELIGIBLE','ineligible'));
  render(<DefectAdmissionControl item={item} disabled={false} onAdmit={vi.fn()}/>);
  expect(await screen.findByText('当前证据不支持瑕疵上架')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('UAT-251 ignores a stale eligible preview after the Run revision changes',async()=>{
  let finish:(value:DefectAdmissionCandidate)=>void=()=>{};
  const preview=vi.spyOn(helixAdminApi,'previewDefectAdmission')
    .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}))
    .mockRejectedValueOnce(new AdminApiError(409,'P9_DEFECT_ADMISSION_INELIGIBLE','ineligible'));
  const view=render(<DefectAdmissionControl item={item} disabled={false} onAdmit={vi.fn()}/>);
  view.rerender(<DefectAdmissionControl item={{...item,currentRun:{...item.currentRun!,stateRevision:2}}} disabled={false} onAdmit={vi.fn()}/>);
  await screen.findByText('当前证据不支持瑕疵上架');
  finish({candidateDigest:'old'} as DefectAdmissionCandidate);
  await waitFor(()=>expect(preview).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button',{name:'接受瑕疵'})).not.toBeInTheDocument();
});
