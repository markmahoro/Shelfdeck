import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PersonReferencesDialog from '../src/helix/PersonReferencesDialog';
import {helixAdminApi,type PeopleProjection} from '../src/helix/api';
import {SessionProvider} from '../src/helix/session';
const person={personId:'actor',canonicalName:'Actor',libraryKind:'us_adult',currentRevision:2,currentReferenceRevision:3} as PeopleProjection['items'][number];
const gallery=(ids=['image'])=>({personId:'actor',libraryKind:'us_adult' as const,currentRevision:2,currentReferenceRevision:3,referenceImages:ids.map(referenceAssetId=>({referenceAssetId}))});
afterEach(()=>vi.restoreAllMocks());
function mount(){const changed=vi.fn();render(<SessionProvider><PersonReferencesDialog person={person} onClose={vi.fn()} onChanged={changed} onUnauthorized={vi.fn()}/></SessionProvider>);return changed;}
it('shows current versioned images and keeps the last usable image while allowing replacement after the picture loads',async()=>{
  vi.spyOn(helixAdminApi,'readPersonReferences').mockResolvedValue(gallery());mount();
  const image=await screen.findByRole('img',{name:'参考图片 1'}),replace=screen.getByRole('button',{name:'替换图片 1'});
  expect(image).toHaveAttribute('src',helixAdminApi.personReferenceUrl('actor','image',3));expect(replace).toBeDisabled();
  fireEvent.load(image);expect(replace).toBeEnabled();expect(screen.getByRole('button',{name:'移除图片 1'})).toBeDisabled();
});
it('retries a lost removal response with the original command and reports completion only after its actual operation completes',async()=>{
  vi.spyOn(helixAdminApi,'readPersonReferences').mockResolvedValueOnce(gallery(['old','keep'])).mockResolvedValue({...gallery(['keep']),currentReferenceRevision:4});
  const release=vi.spyOn(helixAdminApi,'releasePersonReference').mockRejectedValueOnce(new Error('transport')).mockResolvedValue({operationRef:'release',state:'accepted'});
  vi.spyOn(helixAdminApi,'getPersonImageOperation').mockResolvedValue({operationRef:'release',state:'completed',personId:'actor',failureCode:null});const changed=mount();
  fireEvent.load(await screen.findByRole('img',{name:'参考图片 1'}));fireEvent.click(screen.getByRole('button',{name:'移除图片 1'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('尚未收到移除结果');expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'重试移除'}));await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
  expect(release.mock.calls[0]).toEqual(release.mock.calls[1]);expect(release.mock.calls[0]).toEqual(['actor','old',expect.objectContaining({expectedPersonRevision:2,expectedReferenceRevision:3})]);
  expect(screen.getAllByRole('img')).toHaveLength(1);
});
it('keeps the exact old image identity and revisions in a replacement request',async()=>{
  vi.spyOn(helixAdminApi,'readPersonReferences').mockResolvedValue(gallery());
  const update=vi.spyOn(helixAdminApi,'addPersonReference').mockResolvedValue({operationRef:'replace',state:'accepted'});
  vi.spyOn(helixAdminApi,'getPersonImageOperation').mockResolvedValue({operationRef:'replace',state:'completed',personId:'actor',failureCode:null});mount();
  fireEvent.load(await screen.findByRole('img',{name:'参考图片 1'}));fireEvent.click(screen.getByRole('button',{name:'替换图片 1'}));
  fireEvent.change(screen.getByLabelText('上传参考图片'),{target:{files:[new File(['jpeg'],'actor.jpg',{type:'image/jpeg'})]}});
  fireEvent.load(await screen.findByRole('img',{name:'已选择的演员参考图片'}));fireEvent.click(screen.getByRole('button',{name:'确认替换图片'}));
  await waitFor(()=>expect(update).toHaveBeenCalledTimes(1));expect(update.mock.calls[0]).toEqual(['actor',expect.objectContaining({replaceAssetId:'image',expectedPersonRevision:2,expectedReferenceRevision:3})]);
});
it('does not display a gallery returned for another Person library',async()=>{
  vi.spyOn(helixAdminApi,'readPersonReferences').mockResolvedValue({...gallery(),libraryKind:'jav'});mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('参考图片读取失败');expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'补充参考图'})).not.toBeInTheDocument();
});
