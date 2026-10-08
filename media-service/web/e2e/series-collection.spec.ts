import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('shows only collected Episodes and their shared files and parts',async({page},testInfo)=>{
  const shared={materialKey:'shared',name:'Example.S02E01-E03.mkv',sizeBytes:1024,coveredEpisodeCount:2};
  const entry={shelfEntryId:'entry',shelfId:'shelf',shelfName:'剧集',structureKind:'season',status:'active',
    displayIdentity:'示例剧集',year:2020,genres:[],people:[],hasPoster:false,hasNfo:true,occupancyBytes:2048,
    primaryVideoBytes:2048,primaryContainer:null,videoCodec:null,videoRaster:null,health:{state:'healthy'},provider:'tmdb',
    currentInventoryRevision:2,currentDeckFactRevision:2,createdAtMs:1,terminalAtMs:null,defectAdmission:null,
    series:{seasonNumber:2,episodeCount:2,physicalFileCount:2,episodes:[
      {episodeKey:'E001',episodeNumber:1,title:'第一集',files:[shared,{materialKey:'part',name:'Example.S02E01.part2.mkv',sizeBytes:1024,coveredEpisodeCount:1}]},
      {episodeKey:'E003',episodeNumber:3,title:'第三集',files:[shared]},
    ]}};
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/v1/admin/collection'){await route.fulfill({json:{items:[entry],summary:{currentCount:1,historyCount:0},resultCount:1,nextCursor:null}});return;}
    if(path==='/v1/admin/care/entry'){await route.fulfill({json:{shelfEntryId:'entry',health:{state:'healthy'},basis:{inventoryRevision:2},activeCaseProgress:null,history:{assessments:[],findings:[],cases:[],commits:[]}}});return;}
    if(path.endsWith('/defect-admission-candidate')){await route.fulfill({json:{acceptedGaps:[],unavailableRepairs:[],gaps:[],eligibility:'ineligible',ineligibleReasons:['no_current_gaps']}});return;}
    await route.fulfill({json:{items:[],currentRating:null,nextCursor:null}});
  });
  await page.goto('/collection');
  await expect(page.getByText('第 2 季 · 2 集 · 2020 · 剧集')).toBeVisible();
  const tile=page.getByRole('button',{name:/查看 示例剧集 详情/});await tile.click();
  const dialog=page.getByRole('dialog',{name:'示例剧集'});
  await expect(dialog.getByRole('button',{name:'关闭详情'})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button',{name:'退出收藏',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button',{name:'关闭详情'})).toBeFocused();
  const episodes=dialog.getByRole('region',{name:'已收藏剧集'});
  await expect(episodes.getByRole('heading',{name:'第 2 季 · 已收藏 2 集'})).toBeVisible();
  await expect(episodes.getByText('2 个视频文件')).toBeVisible();
  await expect(episodes.getByText('第 2 集',{exact:true})).toHaveCount(0);
  await expect(episodes.getByText(shared.name, {exact:true})).toHaveCount(1);
  await expect(episodes.getByText(/第 1、3 集共用/)).toHaveCount(1);
  await expect(episodes.getByText(/part2/)).toBeVisible();
  expect((await new AxeBuilder({page}).include('.collection-episodes').analyze()).violations).toEqual([]);
  await episodes.scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('series-episodes.png')});
  expect(await episodes.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(tile).toBeFocused();
  expect(errors).toEqual([]);
});
