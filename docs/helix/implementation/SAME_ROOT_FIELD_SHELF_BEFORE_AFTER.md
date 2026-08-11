# Movie测试Material Field：直观Before / After

测试根目录：`C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields`

本表采用第一座Movie Shelf计划中的Placement：`{title} ({year})`。因此根目录裸电影完成上架后会先形成电影文件夹。表中的`<电影名>.nfo`、`<电影名>-poster.jpg`表示Emby可识别的最终Product Artifact名称；准确命名仍由最终Placement合同冻结。

所有成功Movie都需要一条通用Libra产品链：
`libra.product_identity.resolve@1` → `libra.product_metadata.fetch@1` → `libra.media_cast.resolve@1` → `libra.media_cast.commit@1` → `libra.product_sidecar.render@1`（NFO）→ `libra.product_artifact.acquire@1`（Poster）→ `shared.artifact.manifest.verify@1` → `libra.product_metadata.commit@1` → `shared.material.media.probe@1` → `libra.product_media.verify@1` → `libra.product_output.select@1` → `libra.product.conformance.verify@1` → `libra.product_package.publish@1`。

下表第三列中的“通用产品链”即指上面这条链。原始Related只作为输入引用；只有被正式Product Package物化的字幕、Fanart、外部音轨或章节才保证出现在最终电影目录。

| Material Field（当前） | After（Emby最终读取的样子） | 每个Primary预计使用的Libra Capability |
| --- | --- | --- |
| **M01：根目录裸H.264文件**<br><br>`R/`<br>├ `SDT-M01...mkv`<br>├ `SDT-M01...nfo`<br>├ `SDT-M01...-poster.jpg`<br>├ `SDT-M01...-fanart.jpg`<br>└ `SDT-M01...zh-CN.srt` | **会建立电影文件夹。**<br><br>`R/<title> (2008)/`<br>├ `<title>.mkv`（HEVC产品）<br>├ `<title>.nfo`<br>└ `<title>-poster.jpg`<br><br>原始Fanart/字幕若未进入Product Package，仍留在Field根目录。 | `shared.material.media.probe@1` → `libra.transcode.input.verify@1` → `libra.media.transcode@1` → 通用产品链。 |
| **M02：单电影目录**<br><br>`R/SDT-M02.../`<br>├ `SDT-M02...mkv`<br>├ `movie.nfo`、`poster.jpg`、`fanart.jpg`<br>└ 字幕、FLAC、chapters | `R/<title> (2008)/`<br>├ `<原Primary>.mkv`（Direct Input）<br>├ `<title>.nfo`<br>├ `<title>-poster.jpg`<br>└ 可选字幕/Fanart/外部音轨/章节<br><br>若当前位置已经等于Placement结果，Primary无需复制或转码。 | 通用产品链；不调用`libra.media.remux@1`或`libra.media.transcode@1`。 |
| **M03A：多电影目录中的H.264 Primary**<br><br>`R/SDT-M03.../`中的`SDT-M03A...mkv`及同stem Sidecar | `R/<M03A title> (2008)/`<br>├ `<M03A title>.mkv`（HEVC产品）<br>├ `<M03A title>.nfo`<br>└ `<M03A title>-poster.jpg`<br><br>从共享目录中独立成为自己的电影目录。 | `shared.material.media.probe@1` → `libra.transcode.input.verify@1` → `libra.media.transcode@1` → 通用产品链。 |
| **M03B：同一多电影目录中的HEVC MP4 Primary**<br><br>`R/SDT-M03.../`中的`SDT-M03B...mp4`及同stem Sidecar | `R/<M03B title> (2008)/`<br>├ `<原Primary>.mp4`（Direct Input）<br>├ `<M03B title>.nfo`<br>└ `<M03B title>-poster.jpg`<br><br>与M03A分开形成另一电影目录；共享目录中的generic `poster.jpg`不自动归属任何一部。 | 通用产品链；不调用Remux或Transcode。 |
| **M04：4K Premium MKV**<br><br>`R/SDT-M04.../`<br>├ `SDT-M04...mkv`<br>└ NFO、Poster、Fanart | `R/<title> (2008)/`<br>├ `<title>.mkv`<br>├ `<title>.nfo`<br>└ `<title>-poster.jpg`<br><br>如果typed Evidence证明满足5星4K与主音轨要求，Primary可Direct；否则必须取得合格外部产品。 | **Direct分支：**通用产品链。<br><br>**升级分支：**采用M05所列的完整External Acquisition Capability链，再进入通用产品链。 |
| **M05：低清H.264，5星要求**<br><br>`R/SDT-M05.../`<br>├ `SDT-M05...mkv`<br>└ NFO、Poster、Fanart | `R/<title> (2008)/`<br>├ `<外部取得的4K产品>.mkv`<br>├ `<title>.nfo`<br>└ `<title>-poster.jpg`<br><br>原低清Primary不能通过系统Upscale冒充4K产品。 | `libra.external_material.query.prepare@1` → `libra.external_material.search@1` → `libra.external_material.candidate.select@1` → `libra.external_material.acquire.request@1` → `libra.external_material.acquire.observe@1` → `libra.external_material.output.resolve@1` → `libra.external_material.stability.observe@1` → `libra.external_material.identity.verify@1` → `libra.external_material.package.verify@1` → `libra.workspace.material.import@1` → 通用产品链。 |
| **M06：单标题BDMV**<br><br>`R/SDT-M06.../`<br>├ `BDMV/STREAM/00000.m2ts`及结构文件<br>├ `CERTIFICATE/`<br>└ NFO、Poster、Fanart | `R/<title> (2008)/`<br>├ `<title>.mkv`<br>├ `<title>.nfo`<br>└ `<title>-poster.jpg`<br><br>旧BDMV成员在最终产品验证成功后按精确Scope收口；目录本身可能成为空目录并保留。 | `libra.media.remux@1` → `shared.material.media.probe@1` → 通用产品链。 |
| **M07：多标题BDMV**<br><br>`R/SDT-M07.../`<br>├ 两个Playlist/两个M2TS<br>├ 结构文件与`CERTIFICATE/`<br>└ NFO、Poster、Fanart | `R/<title> (2008)/`<br>├ `<确定性主标题产品>.mkv`<br>├ `<title>.nfo`<br>└ `<title>-poster.jpg`<br><br>只产生一部Movie；非主标题不会形成第二个Emby电影。 | `libra.media.remux@1`；若Remux结果仍不满足Spec，再执行`libra.transcode.input.verify@1` → `libra.media.transcode@1`；随后通用产品链。 |
| **M08：可播放MKV但缺少NFO**<br><br>`R/SDT-M08.../`<br>├ `SDT-M08...mkv`<br>└ `poster.jpg` | **当前预期不会形成完整Emby电影目录。**<br><br>原目录保持；Libra停在Metadata未解决，直到Provider或其他正式来源补齐Metadata。 | `libra.product_identity.resolve@1` → `libra.product_metadata.fetch@1`；Metadata仍不足则停止，不调用Package Publish。若Provider补齐，则继续通用产品链。 |
| **M09：损坏MKV**<br><br>`R/SDT-M09.../`<br>├ 损坏的`.mkv`<br>└ `movie.nfo` | 不变化；不会生成新的Emby电影目录。 | 无Libra Capability。Procurement以`probe_not_media`收口，不产生Handoff A。 |
| **M10：只有Sidecar**<br><br>`R/SDT-M10.../`<br>├ `movie.nfo`<br>└ `poster.jpg` | 不变化；不会生成新的Emby电影目录。 | 无Libra Capability。没有Primary，不产生Candidate。 |
| **M11：真实中文HEVC MKV**<br><br>`R/SDT-M11.../`<br>├ `SDT-M11...mkv`<br>├ `movie.nfo`、`poster.jpg`、`fanart.jpg`<br>└ `landscape.jpg` | `R/0.5毫米 (2014)/`<br>├ `0.5毫米.mkv`（Direct Input）<br>├ `0.5毫米.nfo`<br>└ `0.5毫米-poster.jpg`<br><br>Fanart/Landscape只有进入Product Package才保证出现在最终目录。 | 通用产品链；不调用Remux或Transcode。 |
| **M12：真实BDMV**<br><br>`R/SDT-M12.../`<br>├ `BDMV/STREAM/00001.m2ts`及结构文件<br>├ `CERTIFICATE/`<br>├ `movie.nfo`、`poster.jpg`、`fanart.jpg`<br>└ `logo.png` | `R/爆弹 (2025)/`<br>├ `爆弹.mkv`<br>├ `爆弹.nfo`<br>└ `爆弹-poster.jpg`<br><br>原BDMV成员按精确Scope收口；Logo/Fanart只有进入Product Package才进入最终目录。 | `libra.media.remux@1` → `shared.material.media.probe@1` → 通用产品链。 |

补充：M01–M07当前测试NFO重复使用`Big Buck Bunny / TMDB 10378`。要同时运行全套Shelf E2E，必须先给这些正向场景分配互不冲突的测试Identity；否则它们会解析到同一个`<title> (2008)`目标目录，无法得到表中的独立After结果。
