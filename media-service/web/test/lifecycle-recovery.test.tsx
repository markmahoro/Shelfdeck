import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PreparationFailures from '../src/helix/PreparationFailures';
import MaterialExclusions from '../src/helix/MaterialExclusions';
import {helixAdminApi,type MaterialField} from '../src/helix/api';
vi.mock('../src/helix/session',()=>({useSession:()=>({expire}),isUnauthorized:()=>false}));
const expire=vi.fn();
afterEach(()=>vi.restoreAllMocks());

it('recovers a preparation before a Subject exists and removes its failed row only after refresh',async()=>{
 const failed={workId:'failed-intake',subjectId:null,title:'Movie.mkv',phase:'接收材料',failureCode:'TEMPORARY_FAILURE'};
 const list=vi.spyOn(helixAdminApi,'listPreparationFailures').mockResolvedValueOnce({items:[failed],nextCursor:null}).mockResolvedValue({items:[],nextCursor:null});
 const retry=vi.spyOn(helixAdminApi,'retryPreparation').mockResolvedValue({kind:'admitted',workId:'replacement'});
 const changed=vi.fn();render(<PreparationFailures onChanged={changed}/>);
 expect(list).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'准备异常'}));
 expect(await screen.findByText('Movie.mkv')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'重试准备'}));
 await screen.findByText('没有准备异常');expect(retry).toHaveBeenCalledWith('failed-intake');expect(changed).toHaveBeenCalledTimes(1);
});

it('keeps deferred preparation recovery visible without claiming success',async()=>{
 vi.spyOn(helixAdminApi,'listPreparationFailures').mockResolvedValue({items:[{workId:'work',subjectId:null,title:'Movie.mkv',phase:'接收材料',failureCode:'FAILED'}],nextCursor:null});
 vi.spyOn(helixAdminApi,'retryPreparation').mockResolvedValue({kind:'deferred',workId:'work'});
 render(<PreparationFailures onChanged={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'准备异常'}));
 fireEvent.click(await screen.findByRole('button',{name:'重试准备'}));await screen.findByText('当前资源忙，请稍后重试。');
 expect(screen.queryByText('已提交重试')).not.toBeInTheDocument();expect(screen.getByText('Movie.mkv')).toBeInTheDocument();
});

it('revokes the exact exclusion without requesting an observation or retry',async()=>{
 const field={fieldId:'field',name:'电影来源',extractionPolicyRevision:1,policy:{policy:{excludedMaterialKeys:['material']}}} as MaterialField;
 const policy={extractionPolicyId:'policy',revision:1,policy:{excludedMaterialKeys:['material']},policyDigest:'digest'};
 vi.spyOn(helixAdminApi,'getMaterialExclusions').mockResolvedValueOnce({excludedMaterials:[{materialKey:'material',location:'/source/Movie.mkv'}],extractionPolicy:policy} as never)
   .mockResolvedValue({excludedMaterials:[],extractionPolicy:{...policy,revision:2,policy:{excludedMaterialKeys:[]}}} as never);
 const revoke=vi.spyOn(helixAdminApi,'revokeMaterialExclusion').mockResolvedValue({} as never),changed=vi.fn();
 render(<MaterialExclusions field={field} onChanged={changed}/>);
 fireEvent.click(screen.getByRole('button',{name:'已排除文件 1'}));
 fireEvent.click(await screen.findByRole('button',{name:'撤销排除'}));
 await screen.findByText('没有已排除的文件');
 await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));expect(revoke).toHaveBeenCalledWith('field',policy,'material');
});
