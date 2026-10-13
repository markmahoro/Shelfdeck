import { expect, test } from '@playwright/test';

test('a delayed Formation filter shows loading before rows or confirmed empty results',async({page},testInfo)=>{
  const item={aftercareCaseId:'case',shelfEntryId:'entry',displayIdentity:'延迟返回的整理任务',state:'active',classification:'in_progress',goals:['video_codec_unmet'],createdAtMs:100,terminalAtMs:null,reasonCode:null,progress:null};
  const summary={totalCount:1,inProgressCount:1,attentionRequiredCount:0,completedCount:0};
  await page.route('**/v1/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/v1/admin/formation'){
      await route.fulfill({json:{items:[],summary,nextCursor:null,projection:{status:'ready',asOfMs:100}}});return;
    }
    if(url.pathname==='/v1/admin/care'){
      const classification=url.searchParams.get('classification');
      if(classification)await new Promise(resolve=>setTimeout(resolve,1200));
      await route.fulfill({json:{items:classification==='attention_required'?[]:[item],counts:{in_progress:1},nextCursor:null}});return;
    }
    await route.fulfill({json:{items:[],summary,counts:{},nextCursor:null,state:'ready',completionState:'complete'}});
  });
  await page.goto('/formation');
  await expect(page.getByText(item.displayIdentity)).toBeVisible();
  await expect(page.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'需要处理 0',exact:true}).click();
  await expect(page.getByText('正在读取整理条目…')).toBeVisible();
  await expect(page.locator('.quiet-loading-rows')).toBeVisible();
  await expect(page.locator('.formation-ledger')).toHaveAttribute('aria-busy','true');
  await expect(page.getByText('当前筛选没有条目')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('pending-filter.png')});
  await expect(page.getByText('当前筛选没有条目')).toBeVisible();
  await page.getByRole('button',{name:'整理中 2',exact:true}).click();
  await expect(page.getByText('正在读取整理条目…')).toBeVisible();
  await expect(page.getByText('当前筛选没有条目')).toHaveCount(0);
  await expect(page.getByText(item.displayIdentity)).toBeVisible();
  await expect(page.locator('.formation-ledger')).toHaveAttribute('aria-busy','false');
  await page.screenshot({path:testInfo.outputPath('loaded-filter.png')});
});

test('Collection keeps readable content during refresh and uses quiet placeholders only before first content',async({page},testInfo)=>{
  const item={shelfEntryId:'entry',shelfId:'shelf',shelfName:'电影',displayIdentity:'测试收藏',year:2026,hasPoster:false,health:{state:'healthy'},genres:[],people:[],currentInventoryRevision:1};
  await page.route('**/v1/**',async route=>{
    if(new URL(route.request().url()).pathname==='/v1/admin/collection'){
      await new Promise(resolve=>setTimeout(resolve,1200));
      await route.fulfill({json:{items:[item],shelves:[],summary:{currentCount:1,historyCount:0},resultCount:1,nextCursor:null}});return;
    }
    await route.fulfill({json:{items:[],state:'ready'}});
  });
  await page.goto('/collection');
  await expect(page.getByText('正在打开收藏架…')).toBeVisible();
  await expect(page.locator('.quiet-loading-posters')).toBeVisible();
  await expect(page.getByText('还没有正式上架的收藏')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('collection-first-loading.png')});
  await expect(page.getByText(item.displayIdentity,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(page.getByRole('region',{name:'收藏列表'})).toHaveAttribute('aria-busy','true');
  await expect(page.getByText(item.displayIdentity,{exact:true})).toBeVisible();
  await expect(page.locator('.quiet-loading-posters')).toHaveCount(0);
  await expect(page.locator('.quiet-read-track span')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('collection-refresh-loading.png')});
  await expect(page.getByRole('region',{name:'收藏列表'})).toHaveAttribute('aria-busy','false');
  await expect(page.locator('.quiet-read-track span')).toHaveCount(0);
  await page.getByRole('button',{name:/查看 测试收藏 详情/}).focus();
  await expect(page.getByRole('button',{name:/查看 测试收藏 详情/})).toBeFocused();
});
