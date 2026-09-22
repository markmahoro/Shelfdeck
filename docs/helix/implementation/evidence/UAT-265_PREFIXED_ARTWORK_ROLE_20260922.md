# UAT-265 带电影名前缀图片的角色识别

## 问题与范围

用户报告《局内人》入库后没有海报。2026-09-22生产只读核验：Shelf Entry
`c5d3cc94095eaf0a7e051814a09bebfad318643742a3e490f4d85837a31bc81a`于16:13北京时间Commit；
`局内人 (2006) 1080p DTS-poster.jpg`实际存在，249369 bytes，但Inventory revision 1至15均为`sidecar`。
Package记录`missingArtifactKinds=[poster]`，外部获取失败后按standing authorization revision 1接受瑕疵。
不是海报文件在Commit后丢失。生产基线镜像source为`19d13f7b58`。

根因：Procurement关联允许同stem图片，但角色分类仅匹配完整`poster.ext`和`fanart.ext`等通用名称。
带前缀图片因此保留为普通sidecar，Libra无法按海报角色沿用。Candidate Context重建与Triage中的分类逻辑重复。

## 修复与边界

Procurement内部共用`related-artwork-role.js`。在既有目录、同stem、BDMV结构排除和物理身份检查之后，
识别精确`<关联stem>[-._]poster|fanart|background|backdrop`及原有通用名称；扩展名仍限jpg/jpeg/png/webp，
大小写不敏感。不得仅凭任意文件名以poster结尾就认领，不扩大关联目录或跨电影归属，不把sample海报当正片海报。
关联Reference及其digest继续由现有Owner生成。SSOT Related association及Owner边界不变。

验收覆盖中文生产命名、英文含正则符号名称、三种分隔符、四种图片扩展名、大小写、通用名称、其他电影、
不同目录、伪扩展名、非海报附属图、sample前缀；单片/多片/独立文件关联和Reference digest一致性。
原测试将`Feature-fanart.jpg`断言为sidecar，随本次已确认修复更新为fanart。

## 交付状态

Windows本地`node --test test/helix-architecture/p7-*.test.js`：150通过、0失败、0跳过。
覆盖Candidate发布事务、Reference重建、BDMV隔离、Triage、持久化及新增图片分类用例。
追加package-boundary、manifest与修复专项组合21/21通过，`git diff --check`通过。
未执行Linux/Docker、生产UI或实际旧收藏恢复；本次无Desktop、UI、Schema或文件副作用变更。
UAT保持开放直到上线及实际验收。
本次不改生产数据库、现有Candidate/Package/Inventory、媒体文件或历史授权。
《局内人》已Commit，不能靠本修复重写历史或Formation Reset；正式瑕疵修复需由Arca现行流程处理，
新识别规则本身不承诺旧Inventory自动重新分类。生产发布交由指定部署负责人统一安排。
