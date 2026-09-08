# UAT-253 NAS旧发布包必要清理

用户2026-09-08明确授权NAS本项目必要清理。只删除下列32个普通文件；SFTP lstat逐项核对类型/大小后unlink，没有递归删除、镜像prune、清库或媒体处置。逻辑字节合计17,968,979,456；Btrfs异步回收后实测可用36,492,066,816字节，81%使用率。8月31日后包、全部备份、当前工作材料、Docker镜像保留；当前79874990b6和回滚6e37bf5679/275923039f均在保留集。

| 文件（目录 /vol1/1000/docker/shelfdeck） | 字节 |
| --- | ---: |
| shelfdeck-helix-beta-20260828-54f8ac487.tar | 561454592 |
| shelfdeck-helix-beta-20260828-a3e07a1e1.tar | 561522688 |
| shelfdeck-helix-beta-20260828-ef8eec0dc.tar | 561522688 |
| shelfdeck-helix-beta-20260828-c71149f17.tar | 561524224 |
| shelfdeck-helix-beta-20260828-0b757574c.tar | 561524224 |
| shelfdeck-helix-beta-20260828-0279bf5c8.tar | 561524736 |
| shelfdeck-helix-beta-20260828-0b3a268ef.tar | 561524736 |
| shelfdeck-helix-beta-20260828-f0a08d9a4.tar | 561524736 |
| shelfdeck-helix-beta-20260828-1556e0bfa.tar | 561524736 |
| shelfdeck-helix-beta-20260828-28fdf4132.tar | 561525248 |
| shelfdeck-helix-beta-20260828-c637ae508.tar | 561525760 |
| shelfdeck-helix-beta-20260828-c1456c400.tar | 561526272 |
| shelfdeck-helix-beta-20260828-90476efa0.tar | 561527296 |
| shelfdeck-helix-beta-20260829-e4d601cd9.tar | 561528832 |
| shelfdeck-helix-beta-20260829-0eb39ed97.tar | 561528832 |
| shelfdeck-helix-beta-20260829-83d3c4424.tar | 561531904 |
| shelfdeck-helix-beta-20260829-904c415f7.tar | 561532416 |
| shelfdeck-helix-beta-20260829-4c8b965b6.tar | 561532928 |
| shelfdeck-helix-beta-20260829-bd5cc15b4.tar | 561532928 |
| shelfdeck-helix-beta-20260829-c547a2f93.tar | 561532928 |
| shelfdeck-helix-beta-20260829-f68c3f346.tar | 561537024 |
| shelfdeck-helix-beta-20260829-6ad8bc999.tar | 561537024 |
| shelfdeck-helix-beta-20260829-79fc055d1.tar | 561537024 |
| shelfdeck-helix-beta-20260829-2fe558b95.tar | 561537536 |
| shelfdeck-helix-beta-20260829-d1dd611d4.tar | 561537536 |
| shelfdeck-helix-beta-20260830-dd8e35edc.tar | 561540096 |
| shelfdeck-helix-beta-20260830-fa5cedaed.tar | 561540096 |
| shelfdeck-helix-beta-20260830-06d0cc63b.tar | 561540096 |
| shelfdeck-helix-beta-20260830-999a94fa8.tar | 561539072 |
| shelfdeck-helix-beta-20260830-partial1.tar | 561546240 |
| shelfdeck-helix-beta-20260830-5189f5f79.tar | 561557504 |
| shelfdeck-helix-beta-20260830-5189f5f79c.tar | 561557504 |

首批必要空间清理完成并验收关闭。UAT-216源目录和最终工作区引用审查继续各自执行，不因本项关闭一并完成。

## 第二批：22:10作业空间清理

用户再次明确要求先清理NAS且只准触碰本项目文件。应用根realpath精确为`/vol1/1000/docker/shelfdeck`，目录owner1000/group1001/mode771。逐一校验普通文件、大小、mtime、owner，删除前校验全部删除集与保留集；按固定清单SFTP unlink，无递归删除、无Docker prune。

本批删除54个2026-08-31至09-03旧tar，共39,588,767,744字节（36.87 GiB）。保留09-03稳定版本f05d694dfa、09-07/08全部包，共24个tar。全部Docker镜像、生产备份、运行数据库、Workspace、媒体、回收站未修改。计划SHA256为`b02cd38b339d0f8e4ceebc1124d726ddfa63c50362573a9345099d27d85365d4`。

清理后系统卷实测可用70,560,739,328字节（65.71 GiB），使用率62%；媒体卷仍约392 GiB可用。54文件均确认不存在，24保留文件大小未变；29个容器ID/名称/镜像均未变，ShelfDeck镜像及启动时间未变。6个健康/管理/业务GET均200。此时正常运行已产生70部收藏、2个进行中整理；没有停机、Reset或手改业务数据。

原始证据：`.codex/uat253-second-cleanup-plan.json`、`uat253-second-cleanup-result.jsonl`、`uat253-second-state-before.txt`、`uat253-second-state-after.txt`、`uat253-second-capacity-after.log`。作业空间已足够，本批不继续扩大清理范围。

| 删除文件（均位于上述应用根） | 字节 |
| --- | ---: |
| shelfdeck-helix-beta-20260831-710aa1b65a.tar | 561617920 |
| shelfdeck-helix-beta-20260831-5a6f09a19a.tar | 561623040 |
| shelfdeck-helix-beta-20260831-f615594bbf.tar | 561623040 |
| shelfdeck-helix-beta-20260831-9126cb47de.tar | 561623040 |
| shelfdeck-helix-beta-20260831-82861681ce.tar | 561628672 |
| shelfdeck-helix-beta-20260831-182bc86fc2.tar | 561630208 |
| shelfdeck-helix-beta-20260831-fa5a538f57.tar | 561630208 |
| shelfdeck-helix-beta-20260831-791ce31450.tar | 561630208 |
| shelfdeck-helix-beta-20260831-29efa3a229.tar | 561662464 |
| shelfdeck-helix-beta-20260831-ae7a567cde.tar | 561663488 |
| shelfdeck-helix-beta-20260831-91f990609c.tar | 561663488 |
| shelfdeck-helix-beta-20260831-03e85b8e46.tar | 561663488 |
| shelfdeck-helix-beta-20260831-e16ff04ebf.tar | 561664512 |
| shelfdeck-helix-beta-20260831-e655d6d66f.tar | 561665024 |
| shelfdeck-helix-beta-20260831-b06b70ba10.tar | 561665024 |
| shelfdeck-helix-beta-20260831-d6d34b11a6.tar | 561670144 |
| shelfdeck-helix-beta-20260831-cb87e1d695.tar | 561670144 |
| shelfdeck-helix-beta-20260901-0ab91e2439.tar | 561671168 |
| shelfdeck-helix-beta-20260901-04bad50e38.tar | 561672704 |
| shelfdeck-helix-beta-20260901-f3a60dd75c.tar | 561678336 |
| shelfdeck-helix-beta-20260901-84b8d313e0.tar | 561678336 |
| shelfdeck-helix-beta-20260901-05c58945f6.tar | 561678848 |
| shelfdeck-helix-beta-20260901-cd301b8004.tar | 561678848 |
| shelfdeck-helix-beta-20260901-0813ae2991.tar | 561678848 |
| shelfdeck-helix-beta-20260901-59be1f3eca.tar | 561680384 |
| shelfdeck-helix-beta-20260901-237d0fb7b0.tar | 561680384 |
| shelfdeck-helix-beta-20260901-510abb2e40.tar | 561680896 |
| shelfdeck-helix-beta-20260902-a93282f5a3.tar | 561683968 |
| shelfdeck-helix-beta-20260902-45d4c2a9b1.tar | 561684480 |
| shelfdeck-helix-beta-20260902-d293c58753.tar | 561685504 |
| shelfdeck-helix-beta-20260902-713bbc0827.tar | 561685504 |
| shelfdeck-helix-beta-20260902-efe1b91d6e.tar | 561685504 |
| shelfdeck-helix-beta-20260902-0d94f414ac.tar | 561685504 |
| shelfdeck-helix-beta-20260903-d228dc2488.tar | 561687552 |
| shelfdeck-helix-beta-20260903-11c71bc009.tar | 561687552 |
| shelfdeck-helix-beta-20260903-d0bed9af57.tar | 561689600 |
| shelfdeck-helix-beta-20260903-c77cd99951.tar | 1718975488 |
| shelfdeck-helix-beta-20260903-03ba1191d1.tar | 1718976000 |
| shelfdeck-helix-beta-20260903-e1b0b7993d.tar | 1718978048 |
| shelfdeck-helix-beta-20260903-bc25b7907b.tar | 1718978560 |
| shelfdeck-helix-beta-20260903-10689ac2ea.tar | 1718978560 |
| shelfdeck-helix-beta-20260903-245cb92336.tar | 1718978560 |
| shelfdeck-helix-beta-20260903-b87301717d.tar | 1718980096 |
| shelfdeck-helix-beta-20260903-d8d25a95aa.tar | 1718981632 |
| shelfdeck-helix-beta-20260903-bafe58322f.tar | 561698304 |
| shelfdeck-helix-beta-20260903-757dc7571e.tar | 561698304 |
| shelfdeck-helix-beta-20260903-04760c37c8.tar | 561698304 |
| shelfdeck-helix-beta-20260903-a02eced846.tar | 561698816 |
| shelfdeck-helix-beta-20260903-f7c4caf0eb.tar | 561698816 |
| shelfdeck-helix-beta-20260903-d0515207dc.tar | 561699328 |
| shelfdeck-helix-beta-20260903-4e31ee914e.tar | 561699840 |
| shelfdeck-helix-beta-20260903-e540f308cc.tar | 561700352 |
| shelfdeck-helix-beta-20260903-9e73fe7601.tar | 561700352 |
| shelfdeck-helix-beta-20260903-4ee47e37e1.tar | 561700352 |
