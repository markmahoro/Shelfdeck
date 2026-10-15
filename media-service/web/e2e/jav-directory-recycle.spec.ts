import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('correction directory inspection requires the visible exact file list before archive and exposes restore',async({page},testInfo)=>{
  const writes:Record<string,unknown>[]=[],errors:string[]=[];let archived=false,restored=false;
  const source='/shelf/Old Film',digest='a'.repeat(64),preview={shelfEntryId:'entry',sourceLocation:source,manifest:{entries:[{relativePath:'keep.txt',kind:'file',sizeBytes:4,sha256:digest,inode:'1',mtimeNs:'2'}],totalBytes:4},manifestDigest:digest,requiresConfirmation:true};
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/v1/**',async route=>{const path=new URL(route.request().url()).pathname;
    if(path==='/v1/admin/care-recycle'){
      const item={id:'recycled',shelfEntryId:'entry',sourceLocation:source,state:restored?'restored':'archived',reasonCode:'user_confirmed_source_residue',fileCount:1,totalBytes:4,createdAtMs:10,archivedAtMs:11,expiresAtMs:null,errorCode:null};
      await route.fulfill({json:{items:archived?[item]:[],cleanupChecks:[{onDeckRunId:'original',shelfEntryId:'entry',state:'completed',checkedAtMs:1,checks:[{sourceLocation:'/field/original',state:'absent'}]}],correctionChecks:[{correctionId:'correction',shelfEntryId:'entry',state:archived?'completed':'attention',checkedAtMs:2,errorCode:null,checks:[{sourceLocation:source,state:restored?'retained_after_restore':archived?'archived':'awaiting_confirmation'}]}]}});return;
    }
    if(path==='/v1/admin/care-recycle/entry/preview'){await route.fulfill({json:{items:archived?[]:[preview]}});return;}
    if(path==='/v1/admin/care-recycle/entry/actions/archive'){writes.push(route.request().postDataJSON());archived=true;await route.fulfill({status:202,json:{id:'recycled',state:'pending'}});return;}
    if(path==='/v1/admin/care-recycle/recycled/actions/restore'){writes.push(route.request().postDataJSON());restored=true;await route.fulfill({status:202,json:{id:'recycled',state:'restoring'}});return;}
    await route.fulfill({json:{configured:false,settings:{},items:[]}});
  });
  await page.goto('/settings');await page.getByRole('tab',{name:'回收站',exact:true}).click();
  const correction=page.getByRole('region',{name:'身份纠正后的旧目录收尾'}),original=page.getByRole('region',{name:'上架后的旧目录收尾'});
  await expect(correction.getByText(source,{exact:true})).toBeVisible();await expect(original.getByText('/field/original',{exact:true})).toBeVisible();
  await correction.getByRole('button',{name:'检查这部影片的具体清单'}).focus();await page.keyboard.press('Enter');expect(writes).toHaveLength(0);
  await page.getByText('旧目录与回收站',{exact:true}).click();await expect(page.getByText('keep.txt',{exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('jav-directory-confirmation.png'),fullPage:true});
  await page.getByRole('button',{name:'确认以上范围，移入回收站'}).click();await expect(page.getByRole('button',{name:'恢复到原位置'})).toBeVisible();
  expect(writes[0]).toMatchObject({sourceLocation:source,manifestDigest:digest,confirmManifestDigest:digest});
  await page.getByRole('button',{name:'恢复到原位置'}).click();await correction.getByRole('button',{name:'刷新收尾记录'}).click();await expect(correction.getByText('已请求恢复 · 保留')).toBeVisible();
  expect(writes).toHaveLength(2);expect((await new AxeBuilder({page}).include('.recycle-settings').analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('jav-directory-restored.png'),fullPage:true});expect(errors).toEqual([]);
});
