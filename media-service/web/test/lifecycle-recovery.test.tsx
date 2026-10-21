import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import MaterialExclusions from '../src/helix/MaterialExclusions';
import {helixAdminApi,type MaterialField} from '../src/helix/api';
vi.mock('../src/helix/session',()=>({useSession:()=>({expire}),isUnauthorized:()=>false}));
const expire=vi.fn();
afterEach(()=>vi.restoreAllMocks());

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
