# 历史 DDL 测试快照

这些 gzip 文件只含公开仓库历史 DDL，不含数据库、用户数据或凭据；不是运行时迁移脚本。manifest记录完整来源commit、仓库路径、DDL SHA256、表数量和原始字节数。由对应commit的clean-schema.sql逐字节导出，gzip的mtime固定为0。

升级测试先解压并校验字节数和原始DDL摘要，再建立临时数据库。测试不依赖.git、网络或当前DDL倒推旧schema，因此不会将新增表混入历史版本。更新当前schema不应重写这些历史快照；需要新增历史入口时，追加可证明来源的快照。

执行：`node --test test/helix-uat-schema-migration.test.js`（工作目录media-service）。测试通过不授权任何生产升级、数据修复或Formation兼容。
