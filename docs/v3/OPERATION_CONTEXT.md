# ShelfDeck v3 Operation Context

本文只记录 v3 agent 开工需要的操作上下文，不规定 v3 架构实现。

## 1. 当前生产基线

当前生产环境称为 v2。

生产基线说明：

```text
docs/v2/PRODUCTION_BASELINE.md
```

生产部署标准流程：

```text
docs/v2/PRODUCTION_DEPLOYMENT.md
```

当前生产形态：

```text
ShelfDeck service
Docker/Linux
NAS container name: shelfdeck
service port: 18080
```

当前生产镜像在排摸时曾观察到：

```text
markmahoro/shelfdeck:codex-20260629-space-stats-columns
```

实际执行 v3 任务时必须重新检查生产状态，不要只依赖本文记录。

## 2. NAS SSH

NAS SSH 信息保存在私有文件：

```text
tests/TEST_ENV_CHECKLIST.md
```

该文件包含凭据，已被 git 忽略。不要把其中内容写入提交、文档或最终回复。

连接 NAS 的标准工具：

```bash
node tools/ssh-exec.js "<cmd>"
```

部署脚本和 SSH 工具必须通过：

```text
tools/nas-ssh-config.js
```

读取配置。不要在脚本里硬编码 SSH 凭据。

## 3. 生产部署流程

生产只允许走标准 NAS Docker 部署流程，除非先更新并验证新的部署文档。

```bash
bash scripts/build-image.sh <tag>
node scripts/upload-nas-image.js dist-image/shelfdeck-<tag>.tar
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256>
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256> --apply
```

生产部署前必须先读：

```text
docs/v2/PRODUCTION_DEPLOYMENT.md
scripts/build-image.sh
scripts/upload-nas-image.js
scripts/deploy-nas.js
```

## 4. 生产安全

- NAS 是生产环境。
- 未经用户明确授权，不得删除、重置、清空或重建生产数据。
- 不得直接修改 NAS `/vol1/1000/docker/shelfdeck/data` 下的数据文件，除非迁移计划明确要求且用户授权。
- 迁移生产数据前必须先 dry-run，并说明检查项、迁移动作、验证项和回滚方案。
- 部署前必须确保 v2 可回滚。

## 5. 常用生产检查

通过 NAS 本机访问 service：

```bash
node tools/ssh-exec.js "curl -sS http://127.0.0.1:18080/v1/health"
node tools/ssh-exec.js "curl -sS http://127.0.0.1:18080/v1/admin/health"
```

容器状态：

```bash
node tools/ssh-exec.js "docker ps --filter name=shelfdeck"
node tools/ssh-exec.js "docker inspect shelfdeck --format '{{.Config.Image}} {{.Image}} {{.State.Status}} {{.State.StartedAt}}'"
node tools/ssh-exec.js "docker logs shelfdeck 2>&1 | tail -120"
```

## 6. 本地测试入口

常用命令：

```bash
cd media-service && npm test
cd media-service && npm run build:web
bash tests/runner.sh health-check tests/env/ci.env
```

更多测试分层：

```text
docs/v2/TEST_ARCHITECTURE.md
```

开发命令：

```text
docs/v2/DEVELOPMENT_WORKFLOW.md
```

调试流程：

```text
docs/v2/DEBUG_WORKFLOW.md
```

## 7. 应用边界

当前用户意图：

- v3 是全库重写升级，不是在 v2 上继续半改。
- v3 agent 必须先排摸代码库和生产事实，再提出具体架构。
- 不要让本目录中的操作文档限制 v3 agent 的架构判断。

项目三大应用：

```text
media-service   service / Admin Web / 媒体库管理 / Docker
media-desktop   Windows 前端播放应用
media-worker    Docker 远程 GPU/FFmpeg 计算节点
```

具体 v3 是否一轮覆盖全部应用，应由 v3 agent 排摸后提出计划。

## 8. Git tag 约定

不要移动或复用旧 tag：

```text
v1.0.0*
```

当前生产基线应使用新的 v2 tag，例如：

```text
v2.0.0
```

v3 完成后再使用：

```text
v3.0.0
```

具体 tag 名由用户最终确认。

