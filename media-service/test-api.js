const baseUrl = 'http://127.0.0.1:18080';

async function testAPI() {
  console.log('=== 前后端分离测试 ===\n');

  // Test 1: Health check
  console.log('1. 测试健康检查端点');
  const health = await fetch(`${baseUrl}/v1/health`);
  console.log('   GET /v1/health:', await health.json());

  // Test 2: Get config
  console.log('\n2. 测试获取配置');
  const config = await fetch(`${baseUrl}/v1/config`);
  const configData = await config.json();
  console.log('   GET /v1/config: executionMode =', configData.executionMode);

  // Test 3: Patch config
  console.log('\n3. 测试更新配置');
  const patchConfig = await fetch(`${baseUrl}/v1/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: 'http://test.emby.local:8096',
      executionMode: 'auto',
      deleteConcurrency: 3
    })
  });
  const patchedConfig = await patchConfig.json();
  console.log('   PATCH /v1/config: executionMode =', patchedConfig.executionMode, ', deleteConcurrency =', patchedConfig.deleteConcurrency);

  // Test 4: Create task
  console.log('\n4. 测试创建任务');
  const createTask = await fetch(`${baseUrl}/v1/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemId: 'test123',
      itemName: '测试电影',
      actionType: 'delete',
      status: 'pending_manual'
    })
  });
  const task = await createTask.json();
  console.log('   POST /v1/tasks: taskId =', task.id, ', status =', task.status);

  // Test 5: Get tasks
  console.log('\n5. 测试获取任务列表');
  const tasks = await fetch(`${baseUrl}/v1/tasks`);
  const tasksList = await tasks.json();
  console.log('   GET /v1/tasks: 任务数量 =', tasksList.length);

  // Test 6: Get single task
  console.log('\n6. 测试获取单个任务');
  const getTask = await fetch(`${baseUrl}/v1/tasks/${task.id}`);
  const taskDetail = await getTask.json();
  console.log('   GET /v1/tasks/:id: itemName =', taskDetail.itemName);

  // Test 7: Update task
  console.log('\n7. 测试更新任务');
  const updateTask = await fetch(`${baseUrl}/v1/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'queued', progress: 50 })
  });
  const updatedTask = await updateTask.json();
  console.log('   PATCH /v1/tasks/:id: status =', updatedTask.status, ', progress =', updatedTask.progress);

  // Test 8: Execute task action
  console.log('\n8. 测试执行任务');
  const executeTask = await fetch(`${baseUrl}/v1/tasks/${task.id}/actions/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const executeResult = await executeTask.json();
  console.log('   POST /v1/tasks/:id/actions/execute:', executeResult.message);

  // Test 9: Pause task action
  console.log('\n9. 测试暂停任务');
  const pauseTask = await fetch(`${baseUrl}/v1/tasks/${task.id}/actions/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const pauseResult = await pauseTask.json();
  console.log('   POST /v1/tasks/:id/actions/pause:', pauseResult.message);

  // Test 10: Library cache
  console.log('\n10. 测试媒体库缓存');
  const setCache = await fetch(`${baseUrl}/v1/library/cache`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: 'item1', name: '测试项目' }] })
  });
  const cacheResult = await setCache.json();
  console.log('   POST /v1/library/cache: cachedAt =', cacheResult.cachedAt);

  const getCache = await fetch(`${baseUrl}/v1/library/cache`);
  const cacheData = await getCache.json();
  console.log('   GET /v1/library/cache: items count =', cacheData.items.length);

  // Test 11: Douban cache
  console.log('\n11. 测试豆瓣缓存');
  const doubanCache = await fetch(`${baseUrl}/v1/integrations/douban/ratings/cache`);
  const doubanData = await doubanCache.json();
  console.log('   GET /v1/integrations/douban/ratings/cache: entries count =', doubanData.entries.length);

  // Test 12: Delete task
  console.log('\n12. 测试删除任务');
  const deleteTask = await fetch(`${baseUrl}/v1/tasks/${task.id}`, {
    method: 'DELETE'
  });
  console.log('   DELETE /v1/tasks/:id: status =', deleteTask.status);

  // Test 13: Verify task deleted
  console.log('\n13. 验证任务已删除');
  const tasksAfterDelete = await fetch(`${baseUrl}/v1/tasks`);
  const tasksListAfterDelete = await tasksAfterDelete.json();
  console.log('   GET /v1/tasks: 任务数量 =', tasksListAfterDelete.length);

  console.log('\n=== 测试完成 ===');
}

testAPI().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
