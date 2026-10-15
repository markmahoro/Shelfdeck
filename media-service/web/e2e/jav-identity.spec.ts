import {expect,test} from '@playwright/test';
import sharp from 'sharp';
test('JAV initial identity is a workbench action with exact preview, stale input rejection and read-only process detail',async({page},testInfo)=>{
  const sourceLocation='C:/Media/'+('LongFolderName'.repeat(12))+'/Unknown film.mkv';
  const writes:Record<string,unknown>[]=[],item={formationViewId:'jav-subject',subjectId:'jav-subject',displayIdentity:'Unknown film',contentProfile:'jav',structureKind:'single',status:'active',classification:'attention_required',myRating:null,myRatingSource:null,myRatingRevision:null,
    productIdentityIssue:{contentProfile:'jav',result:'not_found',reasonCode:'jav_code_unrecognized',candidateSetDigest:null,candidates:[],claimedCode:null,sourceLocation} as object|null,
    executorIssue:null,primaryMaterialCount:1,addedAtMs:1791948609000,organizingRequirement:'HEVC · 不超过 2 GiB · 补齐 fanart、nfo、poster',organizingAction:'确认番号',organizingSteps:[],
    nextAction:{label:'需要确认番号',state:'attention_required',progress:null},routingState:'resolved',targetShelfId:'jav-shelf',targetShelfName:'JAV',handoffB:null,completedAtMs:null,
    currentRun:{libraRunId:'jav-run',state:'active',stateRevision:1,stateDigest:'run-digest',priorityClass:'normal',packageRevisionHead:0,currentIdentityRevision:null as number|null}};
  const qualified={result:'qualified',javCode:'IPX-177',displayTitle:'示例影片',posterUrl:'https://fixture.test/cover.png',siteRef:'javdb',resourceKey:'fixture',previewId:'preview-1',candidateSetDigest:'candidate-digest',expectedRunStateRevision:1,expectedIdentityRevision:0,expectedSelectionIntentRevision:2};
  const cover=await sharp({create:{width:300,height:180,channels:3,background:'#376892'}}).png().toBuffer();
  await page.route('https://fixture.test/cover.png',route=>route.fulfill({contentType:'image/png',body:cover}));
  let ambiguous=true;
  await page.route('**/v1/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path.endsWith('/actions/choose-product-identity')) {
      writes.push(route.request().postDataJSON());item.productIdentityIssue=null;item.currentRun.currentIdentityRevision=1;item.classification='in_progress';item.displayIdentity='示例影片 (IPX-177)';
      await route.fulfill({status:202,json:{selectionIntentId:'intent-1',intentRevision:3,replayed:false}});return;
    }
    if(path.endsWith('/product-identity-preview')) {
      await new Promise(resolve=>setTimeout(resolve,200));
      const exact=url.searchParams.get('resourceKey');
      await route.fulfill({json:ambiguous&&!exact?{result:'ambiguous',javCode:'IPX-177',candidates:[{siteRef:'javdb',resourceKey:'one',javCode:'IPX-177'},{siteRef:'javdb',resourceKey:'two',javCode:'IPX-177'}]}:qualified});return;
    }
    if(path==='/v1/admin/formation'){await route.fulfill({json:{items:url.searchParams.get('section')==='active'?[item]:[],summary:{totalCount:1,inProgressCount:item.productIdentityIssue?0:1,attentionRequiredCount:item.productIdentityIssue?1:0,completedCount:0},nextCursor:null,projection:{status:'ready',asOfMs:1}}});return;}
    if(path==='/v1/admin/formation/jav-subject'){await route.fulfill({json:item});return;}
    await route.fulfill({json:{items:[],counts:{},nextCursor:null,state:'ready',completionState:'complete'}});
  });
  await page.goto('/formation');const trigger=page.getByRole('button',{name:'确认番号',exact:true});await expect(trigger).toBeVisible();
  await page.getByRole('button',{name:'查看过程'}).click();const detail=page.getByRole('dialog');
  await expect(detail.getByLabel('番号',{exact:true})).toHaveCount(0);await expect(detail.getByRole('button',{name:'确认影片并继续整理'})).toHaveCount(0);
  await detail.getByRole('button',{name:'关闭媒体整理过程卡片',exact:true}).click();await trigger.click();const dialog=page.getByRole('dialog',{name:'确认番号',exact:true});
  await expect(dialog.getByLabel('番号',{exact:true})).toBeFocused();await expect(dialog.getByText(sourceLocation)).toBeVisible();
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('jav-empty.png'),fullPage:true});
  await dialog.getByLabel('番号',{exact:true}).fill('IPX-177');await dialog.getByRole('button',{name:'查询',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'确认影片并继续整理'})).toBeDisabled();await dialog.getByRole('button',{name:'核验候选 2 · JavDB'}).click();
  await expect(dialog.getByText('示例影片')).toBeVisible();await page.screenshot({path:testInfo.outputPath('jav-preview.png'),fullPage:true});
  await dialog.getByLabel('番号',{exact:true}).fill('IPX-178');await expect(dialog.getByRole('button',{name:'确认影片并继续整理'})).toBeDisabled();
  await dialog.getByLabel('番号',{exact:true}).press('Escape');await expect(trigger).toBeFocused();expect(writes).toHaveLength(0);
  await trigger.click();ambiguous=false;await dialog.getByLabel('番号',{exact:true}).fill('IPX-177');await dialog.getByLabel('番号',{exact:true}).press('Enter');
  await expect(dialog.getByText('示例影片')).toBeVisible();await dialog.getByRole('button',{name:'确认影片并继续整理'}).click();
  await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({javCode:'IPX-177',previewId:'preview-1',candidateSetDigest:'candidate-digest',expectedSelectionIntentRevision:2,expectedIdentityRevision:0});
  await expect(page.getByText('示例影片 (IPX-177)',{exact:true})).toBeVisible();await expect(trigger).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('jav-locked.png'),fullPage:true});
});
