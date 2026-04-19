# ARCH_DEPLOYMENT — 部署视图

> **SSOT 路径**：`[ARCH_DEPLOYMENT.md](./ARCH_DEPLOYMENT.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`  
> 系统上下文、路径映射 SSOT 原则与 MCP/REST 分工见同目录 `[ARCH_SYSTEM_OVERVIEW.md](./ARCH_SYSTEM_OVERVIEW.md)`。

## 部署 profile：优先 Windows 与飞牛 fnOS

两种 **部署 profile**，**同一套容器镜像或同一套可执行产物 + 配置**，差异在 **进程管理、路径、GPU 透传**。


| 维度       | Windows（优先）                                                  | 飞牛 fnOS（优先）                                                                                                      |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **形态**   | 服务进程（如 Windows Service / NSSM）或 **Docker Desktop**（若团队统一用容器） | **Docker Compose** 为主                                                                                            |
| **配置**   | 环境变量 + 本地配置文件；数据目录可定 `D:\...\control-plane-data`             | 环境变量 + 卷挂载（数据库、临时转码目录、日志）                                                                                        |
| **媒体路径** | 盘符、SMB 映射；需与 Emby 所见路径一致或可配置映射                               | 飞牛共享文件夹挂载进容器，与 Emby 一致                                                                                           |
| **GPU**  | NVIDIA/AMD 依本机驱动；若用 Docker on Windows 需 WSL2 + GPU 透传策略      | **NVIDIA**：宿主机驱动 + `nvidia-container-toolkit`，Compose 声明 GPU；**AMD 核显**：`/dev/dri` 等（需按机型与系统版本实测）；失败则 **CPU 兜底** |
| **发布物**  | 安装包或 zip + 说明；可选附带 `docker-compose.windows.yml`              | `docker-compose.yml` + 飞牛论坛可参考的 GPU 前置步骤链接（文档内说明）                                                                |


**说明**：「优先」指 **文档、测试矩阵与默认 Compose 先覆盖这两类环境**；不排斥后续泛化到其它 Linux NAS。

## 相关条文

- 路径映射与配置唯一真相（SSOT）：见 `[ARCH_SYSTEM_OVERVIEW.md](./ARCH_SYSTEM_OVERVIEW.md)` **§3.4**。

## 追溯与关联文档


| 文档                                                                         | 关系      |
| -------------------------------------------------------------------------- | ------- |
| `[ARCH_SYSTEM_OVERVIEW.md](./ARCH_SYSTEM_OVERVIEW.md)`                     | 战略与路径原则 |
| `[OPS_DEPLOY_CONTROL_PLANE.md](../operations/OPS_DEPLOY_CONTROL_PLANE.md)` | 控制面运行备忘 |
| `[openapi.yaml](../api/openapi.yaml)`                                      | REST 契约 |
