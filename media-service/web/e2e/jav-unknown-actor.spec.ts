import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('the unified unknown JAV actor exposes related collection work through existing controls',async({page},testInfo)=>{
  const person={libraryKind:'jav',personId:'person-jav-unknown-actor',status:'active',currentRevision:1,canonicalName:'未知演员',
    aliases:[],providerIdentities:[],currentPreferenceRevision:null,currentReferenceRevision:null,createdAtMs:1};
  const entry={shelfEntryId:'entry-jav-unknown',shelfId:'shelf-jav',shelfName:'JAV',contentProfile:'jav',structureKind:'single',status:'active',
    canonicalIdentityRevision:1,canonicalIdentityKey:'jav:FC2-718323',provider:'jav',providerKey:'FC2-718323',identityKind:'jav_code',identityDigest:'a'.repeat(64),
    displayIdentity:'FC2-718323 示例影片',year:2026,overview:'示例影片简介',genres:[],
    people:[{personId:person.personId,displayName:person.canonicalName,role:'actor'}],hasPoster:false,hasNfo:true,occupancyBytes:1024,
    primaryVideoBytes:1024,primaryContainer:'MKV',videoCodec:'HEVC',videoRaster:'1080p',health:{state:'healthy'},
    currentInventoryRevision:1,currentDeckFactRevision:1,createdAtMs:1,terminalAtMs:null};
  const unexpectedWrites:string[]=[],pageErrors:string[]=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET')unexpectedWrites.push(request.method()+' '+path);
    if(path==='/v1/admin/people')return route.fulfill({json:{items:url.searchParams.get('libraryKind')==='jav'?[person]:[],nextCursor:null,
      summary:{activePersonCount:url.searchParams.get('libraryKind')==='jav'?1:0,mergedPersonCount:0,openRegistrationCandidateCount:0,openMergeCandidateCount:0}}});
    if(path==='/v1/admin/people/'+person.personId+'/collection')return route.fulfill({json:{personId:person.personId,libraryKind:'jav',items:[entry],nextCursor:null}});
    if(path==='/v1/admin/collection/'+entry.shelfEntryId)return route.fulfill({json:entry});
    if(path==='/v1/admin/collection')return route.fulfill({json:{items:[entry],resultCount:1,nextCursor:null,shelves:[],summary:{currentCount:1,historyCount:0}}});
    if(path==='/v1/admin/care/'+entry.shelfEntryId)return route.fulfill({json:{activeCase:null,activeCaseProgress:null,health:{state:'healthy'},basis:{careBasisDigest:'proof'}}});
    if(path.endsWith('/defect-admission-candidate'))return route.fulfill({json:{acceptedGaps:[],unavailableRepairs:[],gaps:[],eligibility:'ineligible',ineligibleReasons:['no_current_gaps']}});
    return route.fulfill({json:{items:[],counts:{},nextCursor:null}});
  });
  await page.goto('/people');
  await page.getByRole('tab',{name:'JAV 演员'}).click();
  const card=page.getByRole('article',{name:'未知演员，已登记'});
  await expect(card).toBeVisible();
  await expect(card.getByText('使用姓名首字头像')).toBeAttached();
  await expect(card.getByRole('img')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'新建演员'})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('jav-unknown-person.png'),fullPage:true});
  const works=card.getByRole('button',{name:'查看 未知演员 的相关作品'});
  await works.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'未知演员 的相关作品'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('link',{name:entry.displayIdentity+' 2026 · JAV'}).click();
  const details=page.getByRole('dialog',{name:entry.displayIdentity});
  await expect(details.getByText('未知演员',{exact:true})).toBeVisible();
  await expect(details.getByText('演职人员',{exact:true})).toBeVisible();
  expect((await new AxeBuilder({page}).include('.collection-dialog').analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('jav-unknown-collection.png'),fullPage:true});
  await page.keyboard.press('Escape');await expect(details).toHaveCount(0);
  expect(unexpectedWrites).toEqual([]);
  expect(pageErrors).toEqual([]);
});
