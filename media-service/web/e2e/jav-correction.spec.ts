import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';

test('collected JAV correction previews precise consequences and follows the owned status while keeping process detail separate',async({page},testInfo)=>{
  const errors:string[]=[],writes:Record<string,unknown>[]=[],cover=await sharp({create:{width:200,height:300,channels:3,background:'#376892'}}).jpeg().toBuffer();
  const entry={shelfEntryId:'entry',shelfId:'shelf',shelfName:'JAV',structureKind:'single',status:'active',displayIdentity:'原影片',year:null,genres:[],people:[],overview:null,
    hasPoster:true,hasNfo:true,occupancyBytes:2048,primaryVideoBytes:1024,primaryContainer:'matroska',videoCodec:'hevc',videoRaster:'1080p',health:{state:'healthy'},provider:'jav',providerKey:'IPX-177',identityKind:'jav_code',
    currentInventoryRevision:1,currentDeckFactRevision:1,createdAtMs:1,terminalAtMs:null,defectAdmission:null};
  const qualified={result:'qualified',previewId:'preview',shelfEntryId:'entry',basisDigest:'basis',proposalDigest:'proposal',placementPreviewDigest:'placement',oldIdentity:{javCode:'IPX-177',title:'原影片'},
    newIdentity:{javCode:'IPX-178',title:'新影片',posterUrl:'data:image/jpeg;base64,'+cover.toString('base64'),siteRef:'javdb'},
    paths:[{materialKey:'video',role:'primary_payload',previousLocation:'/shelf/原影片/原影片.mkv',targetLocation:'/shelf/新影片/新影片.mkv',targetEndpointId:'target'}]};
  const accepted={correctionId:'correction',shelfEntryId:'entry',state:'admitted',stateRevision:1,admissionDigest:'admission',updatedAtMs:100,replayed:false};let completed=false,failed=false,cleanupPolls=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/v1/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path.endsWith('/poster')){await route.fulfill({contentType:'image/jpeg',body:cover});return;}
    if(path==='/v1/admin/collection'){await route.fulfill({json:{items:[entry],summary:{currentCount:1,historyCount:0},resultCount:1,nextCursor:null}});return;}
    if(path==='/v1/admin/care/entry'){await route.fulfill({json:{shelfEntryId:'entry',health:{state:'healthy'},basis:{inventoryRevision:1},activeCaseProgress:null,history:{assessments:[],findings:[],cases:[],commits:[]}}});return;}
    if(path.endsWith('/defect-admission-candidate')){await route.fulfill({json:{acceptedGaps:[],unavailableRepairs:[],gaps:[],eligibility:'ineligible',ineligibleReasons:['no_current_gaps']}});return;}
    if(path.endsWith('/jav-correction')){await route.fulfill({json:{correction:null}});return;}
    if(path.endsWith('/preview-jav-correction')){
      if(url.searchParams.get('javCode')==='FC2-718323'){await route.fulfill({json:{result:'not_qualified',javCode:'FC2-718323'}});return;}
      await route.fulfill({json:qualified});return;
    }
    if(path.endsWith('/confirm-jav-correction')){
      writes.push(route.request().postDataJSON());
      if(!failed){failed=true;await route.fulfill({status:503,json:{error:{code:'TEST_UNAVAILABLE',message:'private implementation'}}});return;}
      await route.fulfill({status:202,json:accepted});return;
    }
    if(path.endsWith('/jav-corrections/correction')){
      completed=true;entry.displayIdentity='新影片';entry.providerKey='IPX-178';entry.currentInventoryRevision=2;
      await route.fulfill({json:{...accepted,state:'committed',cleanupState:cleanupPolls++===0?'pending':'completed',cancellation:{available:false,reasonCode:'not_attention_required'},stateRevision:3,oldJavCode:'IPX-177',newJavCode:'IPX-178'}});return;
    }
    await route.fulfill({json:{items:[],currentRating:null,nextCursor:null}});
  });
  await page.goto('/collection');const tile=page.getByRole('button',{name:/查看 原影片 详情/});await tile.click();await page.getByRole('button',{name:'核对影片',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'核对影片',exact:true});await expect(page.getByRole('dialog')).toHaveCount(1);await expect(dialog.getByLabel('新番号')).toBeFocused();
  await dialog.getByLabel('新番号').fill('FC2-718323');await dialog.getByLabel('新番号').press('Enter');await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button',{name:'确认纠正'})).toBeDisabled();
  await dialog.getByLabel('新番号').fill('IPX-178');await dialog.getByLabel('新番号').press('Enter');await expect(dialog.getByLabel('新旧影片预览')).toBeVisible();
  await expect(dialog.getByText('原影片',{exact:true})).toBeVisible();await expect(dialog.getByText('新影片',{exact:true})).toBeVisible();
  await dialog.getByText('文件位置 · 1 项').click();await expect(dialog.getByText('/shelf/原影片/原影片.mkv')).toBeVisible();await expect(dialog.getByText('/shelf/新影片/新影片.mkv')).toBeVisible();
  expect((await new AxeBuilder({page}).include('.jav-correction').analyze()).violations).toEqual([]);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await expect(dialog.getByRole('button',{name:'确认纠正'})).toBeInViewport();await page.screenshot({path:testInfo.outputPath('jav-correction-preview.png'),fullPage:true});
  await dialog.getByRole('checkbox').check();const confirm=dialog.getByRole('button',{name:'确认纠正'});await confirm.focus();await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'关闭',exact:true}).first()).toBeFocused();
  await confirm.click();await expect(dialog.getByRole('alert')).toHaveText('核对未完成，请重试。');expect(completed).toBe(false);
  await confirm.click();await expect(dialog.getByText('等待纠正')).toBeVisible();await expect(dialog.getByText('身份已更新 · 等待清理')).toBeVisible();
  await expect(dialog.getByLabel('新番号')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'完成',exact:true})).toHaveCount(0);
  await expect(dialog.getByText('身份已纠正')).toBeVisible();
  expect(writes).toHaveLength(2);expect(writes[0]).toEqual(writes[1]);expect(writes[0]).toMatchObject({previewId:'preview',basisDigest:'basis',proposalDigest:'proposal',placementPreviewDigest:'placement'});
  await page.screenshot({path:testInfo.outputPath('jav-correction-completed.png'),fullPage:true});await dialog.getByRole('button',{name:'完成',exact:true}).click();await expect(page.getByText('新影片',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
