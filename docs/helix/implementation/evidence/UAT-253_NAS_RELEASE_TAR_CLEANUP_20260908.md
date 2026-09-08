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
