# 非 Helix 产品入口

本目录下的页面**不是** ShelfDeck Helix Admin Web 的正式产品入口。

正式入口由 `src/App.tsx` 接入 `src/helix/` 八页：概览、我的收藏、媒体整理工作区、退出收藏、人物、文件来源配置、收藏架配置、系统设置。

这里的文件仅保留给历史合同测试（如 `admin-web-contract.test.js`、`kairox-rebaseline-audit.test.js`）读取，不得再接到 `/admin` 路由。
