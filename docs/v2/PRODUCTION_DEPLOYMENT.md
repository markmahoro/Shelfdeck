# PRODUCTION_DEPLOYMENT - 生产部署固定入口

本文是 ShelfDeck 当前唯一生产部署入口。当前生产部署方式固定为：本机 build image -> 导出 tar -> 上传到 NAS -> `deploy-nas.js` dry run -> `deploy-nas.js --apply`。Codex 处理任何“上线、部署、升级 NAS、发布 Docker、生产环境”相关任务时，必须先读本文，再读 `scripts/build-image.sh` 和 `scripts/deploy-nas.js`。

## 当前生产环境

| 项 | 固定值 |
| --- | --- |
| 生产形态 | NAS Docker 单容器 `shelfdeck` |
| 生产地址 | `http://192.168.12.230:18080` |
| NAS SSH | `192.168.12.230:22`，凭据见 `tests/TEST_ENV_CHECKLIST.md` |
| NAS compose 目录 | `/vol1/1000/docker/shelfdeck` |
| NAS compose 文件 | `/vol1/1000/docker/shelfdeck/docker-compose.yml` |
| NAS 数据目录 | `/vol1/1000/docker/shelfdeck/data` |
| 镜像名 | `markmahoro/shelfdeck:<tag>`，同时打 `latest`，但生产不从 DockerHub pull |
| 容器内 service 端口 | `18080` |
| 容器内数据目录 | `/app/data` |
| 成人库挂载 | NAS `/vol02/1000-0-24018892` -> 容器 `/adult_media` |

`media-service/docker-compose.example.yml` 只是新环境模板，不是当前 NAS 生产 compose 的来源。不要根据模板推断当前生产挂载；以 NAS 上的 `/vol1/1000/docker/shelfdeck/docker-compose.yml` 和本文件为准。

## 标准发布流程

1. 在本机从仓库根目录构建生产镜像 tarball：

```bash
bash scripts/build-image.sh <tag>
```

输出文件为 `dist-image/shelfdeck-<tag>.tar`。

2. 计算本地 tarball 的 SHA-256，用于上传后校验：

```bash
sha256sum dist-image/shelfdeck-<tag>.tar
```

Windows PowerShell 可用：

```powershell
Get-FileHash dist-image\shelfdeck-<tag>.tar -Algorithm SHA256
```

3. 将 tarball 上传到 NAS 的 ShelfDeck 目录，例如：

```bash
scp dist-image/shelfdeck-<tag>.tar gezhu@192.168.12.230:/vol1/1000/docker/shelfdeck/
```

`scp` 依赖 SSH 连接。连接中断时通常会失败并留下不完整文件，所以部署前必须用 `--sha256` 让部署脚本在 NAS 上校验 tarball；校验不通过不得部署。

4. 先 dry run 部署脚本，检查将要执行的生产步骤：

```bash
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256>
```

5. 如果 dry run、SHA-256 校验和脚本内检查通过，继续执行 apply：

```bash
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256> --apply
```

## 部署脚本的固定契约

`scripts/deploy-nas.js` 是当前唯一允许的自动化生产发布入口。它默认 dry run；加 `--apply` 后才会连接 NAS 并执行变更。当前项目处于开发期，部署流程优先保持固定、快速、可重复；脚本会展示正在运行的 `ffmpeg` 进程，但不会因此阻塞部署。

apply 模式必须保持这些保护：

- 部署前检查 tarball、可选 SHA-256 和 NAS compose 文件。
- 由 tarball 文件名 `shelfdeck-<tag>.tar` 推导目标镜像 `markmahoro/shelfdeck:<tag>`，并更新 NAS compose 的 `image:`。
- 展示 live 容器里当前 `ffmpeg` 进程，作为中断风险提示；开发期部署允许中断这些任务，后续孤儿文件可另行清理。
- 部署前备份 `config.json`、`library.json` / `library.db`、`tasks.json` / `tasks.db`。
- 通过 NAS 上的 compose 文件 `docker compose up -d --force-recreate` 重建容器。
- 部署后检查 `/v1/health`、成人库挂载、代码来自镜像而不是源码挂载、关键 scraper 模块可加载。
- 部署前后输出数据文件大小，便于发现配置或任务数据异常。

不要绕过此脚本直接在生产 NAS 上执行 `docker stop`、`docker rm`、`docker compose down`、删除数据文件、清空任务、替换 compose，除非用户明确要求这类生产破坏性操作。

## Codex 处理规则

- 当用户要求“部署、上线、发布到 NAS、升级生产”时，该请求本身就是执行完整标准发布流程的授权；Codex 不需要在 dry run 后再次询问是否可以 `--apply`。
- dry run 失败、SHA-256 不匹配、health check 失败、挂载校验失败或其他脚本检查失败时，必须停止并报告失败原因，不能强行继续。
- 生产是 `192.168.12.230:18080`，本地测试是 `127.0.0.1:18080`；不要混用。
- 本地 `media-service/data/*.json` 和测试数据库可以重置；NAS `/vol1/1000/docker/shelfdeck/data` 不可随意修改。
- `docker compose -f media-service/docker-compose.example.yml up -d` 只用于本地或新环境验证，不是 NAS 生产部署方式。
- 不使用 DockerHub pull 作为当前生产部署路径；如以后切换 registry 部署，必须先更新本文和部署脚本的安全检查。
- 不要把源码目录 bind mount 到生产容器；生产代码必须来自构建出的 Docker image。
- 当前开发期允许部署中断正在运行的转码、刮削、删除、洗版任务；不要改用其他部署方法规避这个固定流程。
- 涉及生产问题排查时，先读 `tests/TEST_ENV_CHECKLIST.md` 和 `docs/v2/DEBUG_WORKFLOW.md`，但只做只读诊断，除非用户明确授权变更生产状态。

## 部署后的最小验收

```bash
curl -fsS http://192.168.12.230:18080/v1/health
```

如果改动涉及 Admin Web、配置、任务调度、成人库、转码或外部集成，还应按 `docs/v2/TEST_ARCHITECTURE.md` 补跑对应 flow。生产验收命令应优先使用只读接口。
