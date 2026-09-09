# UAT-245 概览标准发布

2026-09-09，用户既有标准NAS发布授权持续有效。允许中断FFmpeg；未Reset、直接改生产SQL或修改媒体。此次无Schema/路由/Desktop源码变化，未重跑无关完整媒体E2E。

- 功能source `0d1047e996`，最终source `7ceaeca7fb`补上生成失败的标准运行诊断；生产镜像`markmahoro/shelfdeck:helix-beta-20260909-7ceaeca7fb`。
- Image ID `sha256:12db15cbc07e12becd793b20cb0f1270e03ec29241ddab05f4dde42d8152eb83`；StartedAt `2026-09-09T11:11:57.671388692Z`，running、0重启。
- Tar `/vol1/1000/docker/shelfdeck/shelfdeck-helix-beta-20260909-7ceaeca7fb.tar`；SHA256 `2b5d16ee6d023540c567890e1bec4d0987df6dfaa3becf86be19ecc08d251f26`，本地/上传远端一致。较早构建`0d1047e996`未部署，不作为生产身份。
- 一致备份`/vol1/1000/docker/shelfdeck/backups/uat-iteration-20260909-overview-projection-predeploy`，11:08:04.828Z完成；DB SHA256 `4e992782700bc715cc6c5f8faf2287f61bd63f204f21fc453eeb4d975ca6c824`，下载副本再次一致。Compose、secret.env、Admin凭据和3份加密Integration envelope保留。
- 回滚版本`1570985359`与tar保留；SHA256 `3a4c4c6c44ed44da0d5c18b068550d7ef135c55dbc5d25dccdf4ab080a6cef8b`。需要时使用标准deploy-nas.js先dry run后apply，不默认恢复数据库。

fnOS预检通过，/vol1约51GiB可用；标准build-image.js、upload-nas-image.js、checksum、deploy-nas.js dry run/apply、readiness、health/Admin、全部必需持久化/媒体/GPU挂载、精确镜像与无源码覆盖检查通过。

11:13:11.716Z六路只读GET均200：82收藏，Formation total78/inProgress2/attention0/completed76/ended3，Care44完成/11结束，Recycle4。125/250既有`P4_EVENT_RECOVERY_INPUT_DRIFT`仍在日志出现。

最终镜像与真实页面响应、状态语义、4000行SQLite分批和失败/停机测试见[245验收](UAT-245_OVERVIEW_PROJECTION_ACCEPTANCE_20260909.md)。245独立关闭，累计63项功能关闭、36项开放。
