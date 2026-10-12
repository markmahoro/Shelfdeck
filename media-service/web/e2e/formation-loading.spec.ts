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
  await expect(page.getByText('当前筛选没有条目')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('pending-filter.png')});
  await expect(page.getByText('当前筛选没有条目')).toBeVisible();
  await page.getByRole('button',{name:'整理中 2',exact:true}).click();
  await expect(page.getByText('正在读取整理条目…')).toBeVisible();
  await expect(page.getByText('当前筛选没有条目')).toHaveCount(0);
  await expect(page.getByText(item.displayIdentity)).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('loaded-filter.png')});
});
