import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('collection watched controls expose true, false and clear with independent rating',async({page},testInfo)=>{
  let watched:boolean|null=null,revision=0;const writes:Record<string,unknown>[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const entry={shelfEntryId:'entry',shelfId:'shelf',shelfName:'JAV',structureKind:'single',status:'active',displayIdentity:'测试影片',year:null,genres:[],people:[],overview:null,hasPoster:false,hasNfo:true,occupancyBytes:2048,primaryVideoBytes:1024,primaryContainer:'matroska',videoCodec:'hevc',videoRaster:'1080p',health:{state:'healthy'},provider:'jav',providerKey:'IPX-177',identityKind:'jav_code',currentInventoryRevision:1,currentDeckFactRevision:1,createdAtMs:1,terminalAtMs:null,defectAdmission:null};
  await page.route('**/v1/**',async route=>{const path=new URL(route.request().url()).pathname;
    if(path==='/v1/admin/collection'){await route.fulfill({json:{items:[entry],summary:{currentCount:1,historyCount:0},resultCount:1,nextCursor:null}});return;}
    if(path==='/v1/admin/care/entry'){await route.fulfill({json:{shelfEntryId:'entry',health:{state:'healthy'},basis:{inventoryRevision:1},activeCaseProgress:null,history:{assessments:[],findings:[],cases:[],commits:[]}}});return;}
    if(path.endsWith('/defect-admission-candidate')){await route.fulfill({json:{acceptedGaps:[],unavailableRepairs:[],gaps:[],eligibility:'ineligible',ineligibleReasons:['no_current_gaps']}});return;}
    if(path==='/v1/admin/perception/records'){
      if(route.request().method()==='POST'){const command=route.request().postDataJSON();writes.push(command);expect(command.expectedRevision).toBe(revision);watched=command.watched;revision++;await route.fulfill({status:202,json:{operationRef:'watched-'+revision,state:'accepted',expectedResultRevision:revision}});return;}
      await route.fulfill({json:{items:[],nextCursor:null,currentRating:{state:'ready',rating:4,sourceKind:'shelfdeck_direct',expectedRevision:1},currentWatched:{state:'ready',watchedState:watched,sourceKind:watched===null?null:'shelfdeck_direct',expectedRevision:revision}}});return;
    }
    await route.fulfill({json:{items:[],nextCursor:null}});
  });
  await page.goto('/collection');await page.getByRole('button',{name:/查看 测试影片 详情/}).click();
  const control=page.getByLabel('测试影片已看状态');await expect(control.getByText('未标记')).toBeVisible();
  await control.getByRole('button',{name:'已看',exact:true}).focus();await page.keyboard.press('Enter');await expect(control.getByRole('button',{name:'已看',exact:true})).toHaveAttribute('aria-pressed','true');
  await control.getByRole('button',{name:'未看',exact:true}).click();await expect(control.getByRole('button',{name:'未看',exact:true})).toHaveAttribute('aria-pressed','true');
  await control.getByRole('button',{name:'清除我的标记'}).click();await expect(control.getByText('未标记')).toBeVisible();
  await expect(page.getByLabel('测试影片评分').getByText('4 星 · 我的评分')).toBeVisible();
  expect(writes.map(item=>item.watched)).toEqual([true,false,null]);expect(writes.every(item=>!Object.hasOwn(item,'rating'))).toBe(true);
  expect((await new AxeBuilder({page}).include('.collection-rating').analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('watched-cleared.png'),fullPage:true});expect(errors).toEqual([]);
});
