# 全站壳层三项独立验收

2026-09-09 02:30，生产source `1a3f4254dc`。历史实现已存在，本次补齐各项Oracle，不批量代替其他视觉或业务项。

| UAT | 原问题与代码依据 | 真实验收和结论 |
| --- | --- | --- |
| 221 | 旧侧栏“收藏运营台 / 本地Projection”主文案。当前App统一品牌和surface-model八路导航，不再从单页拼装口号。 | Edge同一生产会话实际点击概览、我的收藏、媒体整理工作区、退出收藏、人物、文件来源、收藏架配置、系统设置，八个h1与导航匹配。侧栏均为ShelfDeck/媒体库管家/实际系统状态/导航，无两项旧口号，关闭。 |
| 237 | 原八页复制认证状态和登录卡。App外层只有一个SessionProvider，八页401交由expire；createSession只发送一次明确POST换会话，正式入口未存储plaintext key。 | 新增八路401参数化测试，加原登录文案/错误测试共10项PASS；每路一个密码输入/一个登录按钮/一个auth-card，未自行POST验证。Edge隔离18200真实过期→统一登录→虚构错误凭据→中文失败提示，卡片/控件/错误布局已截图检查。生产八页连续导航保持现有会话，未注销生产用户、未输入真实凭据，关闭。 |
| 238 | 旧theme.css与Helix样式并入、废弃pages混用。main.tsx只接App，App只导入helix.css，Collection/Offdeck导入同一collection.css；正式页面没有src/pages或styles/theme.css导入。旧目录README明确仅历史合同测试使用，不机械删除。 | 构建入口和引用已审计；生产当前JS/CSS与本地实际构建字节一致，八页生产真实打开未出现第二套壳层。旧theme未挂入入口；额外缓存或移除历史文件不是本项条件，关闭。 |

## 证据与边界

- `web/test/session.test.tsx` 10项PASS，新增八路覆盖用于验证实际401传播、单一认证UI和无自动重复认证请求，不仅检查源码字符串。
- 生产JS `/assets/index-BMDgeXwY.js` 429956 bytes，SHA256 `f493239bd2c227d2c48e9e51b93be7f20d24ee1f75c3bb21ae4f10fd1b181995`；CSS `/assets/index-CMRaSUbH.css` 52937 bytes，SHA256 `de90612868c43eb315b421e7dbd3245f844b92c6ad4a9eabe6e18ef5a09345ab`。`.codex/uat238-asset-parity.json`保存生产/local一致结果。
- 18200仅模拟会话过期/错误凭据，未向生产发送认证失败或修改会话；`.codex/uat237-browser-requests.json`只记录method/path，不记录请求体或凭据。生产已登录链由同一真实浏览器的八页导航证明。
- 本次只有测试和验收文档变化，现有生产代码已满足；不为关闭重新部署相同代码。251的新终局/手动修复未实现，230系统状态等其他行也不随本记录自动关闭。

三项均关闭。本轮累计26项关闭、73项待实施/验收，206承接另核。
