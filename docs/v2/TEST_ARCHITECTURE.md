# TEST_ARCHITECTURE - 测试入口

## 常用命令

```bash
cd media-service && npm test
cd media-desktop && npm test
bash tests/runner.sh health-check tests/env/ci.env
bash tests/runner.sh all tests/env/docker-fn.env
```

## 环境

| 环境 | 覆盖 | 说明 |
| --- | --- | --- |
| local Windows | service Windows + desktop | `http://127.0.0.1:18080` |
| NAS Docker | service Docker + 外部依赖 | `http://192.168.12.230:18080` |
| transcode node | remote FFmpeg/GPU worker | 默认 `http://<node>:19000` |
| CI | 无外部依赖 smoke | GitHub Actions |

私有凭据在 `tests/TEST_ENV_CHECKLIST.md`，不提交。

## Flow 脚本

| Flow | Script | 依赖 |
| --- | --- | --- |
| health-check | `tests/flows/test-health-check.sh` | 无 |
| task-crud | `tests/flows/test-task-crud.sh` | 无 |
| config-roundtrip | `tests/flows/test-config-roundtrip.sh` | 无 |
| delete-flow | `tests/flows/test-delete-flow.sh` | 真实媒体 |
| transcode-flow | `tests/flows/test-transcode-flow.sh` | FFmpeg/GPU/真实媒体 |
| upgrade-flow | `tests/flows/test-upgrade-flow.sh` | MoviePilot/Emby/真实媒体 |
| media-library-flow | `tests/flows/test-media-library-flow.sh` | Emby/Douban |

报告测试结果时说明实际运行的命令和覆盖范围。
