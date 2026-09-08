# UAT-145 普通HTTP文件来源保存验收

2026-09-08，Edge真实用户操作；隔离服务使用本机非localhost的普通HTTP地址192.168.12.140:18187，干净临时数据库与空目录，无生产挂载。

- 浏览器登录→文件来源→输入来源名称/空目录→保存，出现唯一活动来源，未复现crypto.subtle.digest异常。
- 后端只读重取同一Extraction Policy，按合同`{extractionPolicyId,revision,...policy}`以Node canonicalDigest重算，与持久化digest `a92abf2858c8d261494600a58fc2650f21cb8758ec559220185d7f9d765541d3`一致。仅对policy子对象求摘要不是本合同，不能据此误判失败。
- 再提交同临时根下不存在的目录，页面明确显示“电影目录不存在或当前不可读取。”，来源仍为1，没有误建第二条。
- 既有SHA256 FIPS空串/abc向量及缺crypto.subtle的HTTP分支测试包含在Web59项PASS中；build PASS。
- 后续后台观察空目录完成1页，0媒体包/0整理Run。没有为了验收更改生产Field、Secret、Landing或媒体文件。

结论：UAT-145验收关闭。历史交付c71149f17保持追溯；本次只补真实普通HTTP保存与错误路径证据，不把其他UAT一并关闭。
