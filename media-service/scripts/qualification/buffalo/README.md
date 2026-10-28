# buffalo_l Phase 1 qualification

这是隔离技术验证入口，不是正式 Runtime 接线、人物建档功能或发布安装器。主目录识别及自建参考库均使用同一 512 维模型方法；不导入 Mirex 代码，不回退到 SFace，不创建独立识别服务。

- `parity-policy.json`：首次推理前固定的模型 SHA、输入上限、比较容差和资源门槛。不能根据结果事后放宽。
- `reference.py`：仅在固定 Sense 2 CPU 镜像内运行的离线对照程序；导出三张现有参考图及派生场景的检测/特征/检索结果。不是 ShelfDeck 的 Python 运行依赖，不执行 Sense HTTP 服务、Stash 查询或联网识别。
- `reference-components.py`：同一对照环境下的 OpenCV/PIL 像素级预处理证据，无模型推理。
- `buffalo-math.js` / `image-engine.js`：Node 内置数值和 ONNX 图片引擎原型。遵循固定 Sense 的实际 RGB-array、通道交换、SCRFD、五点对齐、归一化和有界 roll correction 方法，不凭通用颜色习惯改变查询特征。
- `catalogue.js`：原始 USearch 索引只读映射，SQLite 只读查资料，原始 JSON 姓名链接/姿态规则；明确记录 null identity/null yaw/SQLite无行的空槽排除，其他引用矛盾失败。目录不是 People Store，不能产生 Person 或 Merge。
- `image-session.js`：沿 Service 既有 Node 计算隔离机制建立单操作槽，验证无隐藏队列、取消/时限和关闭；没有业务调度、远端 Worker 或 External Job。
- `run-parity.js` / `run-components.js`：固定对照、原编码图片、自建参考样本、空槽和资源测试。控制面探针只测当前测试进程的 HTTP/event-loop 响应，不代表真实 Host 业务 health。

Linux 容器挂载合同：`/source`为只读源码，`/qualification`为只读三张输入图片，`/catalogue`为只读固定数据/模型，`/reference`为只读对照产物，`/retired-slot-vectors.json`为只读空槽查询样本，`/output`为唯一可写实验结果目录。`/components`用于只读预处理对照。不得挂载生产数据库、可写来源/收藏根、Docker socket或凭据；禁用网络和宿主端口映射，CPU/内存/PID/时限按 Evidence 固定。

本阶段 Node 检索依赖固定 `usearch@2.25.3`（支持 Node >=20）；npm 包完整性为 `sha512-mvg6/hBVlx/4dQxa9Yj2ED/wiOhRM6GOw6vRRT+/4H2uYmXGcOO/v9fbf36UA6ycIbaSNzbdLXtbVBvd5JLcfA==`。模型运行使用 ShelfDeck 既有 `onnxruntime-node@1.30.0`。Python oracle 的不同依赖版本完整保存在实验报告，不把它们加入产品依赖。

方法来源：固定 [Sense 2 commit](https://github.com/AnonTester/stash-sense2/tree/7a690aa80c390a69d64934c6201076ae05f94e59) 的 embeddings/matching；其实际依赖 InsightFace 0.7.3；[OpenCV 4.11 resize](https://github.com/opencv/opencv/blob/4.11.0/modules/imgproc/src/resize.cpp) 的整数插值规则、[Pillow 12.3 nearest-affine](https://github.com/python-pillow/Pillow/blob/12.3.0/src/libImaging/Geometry.c) 的固定点取样及 [USearch](https://github.com/unum-cloud/usearch)。数值实现为独立验证代码，原始图片/向量输出和第三方二进制不提交仓库。

许可边界：Sense 代码 MIT、USearch Apache-2.0；模型权重不能据此称为 MIT。InsightFace 官方将权重用于非商业研究，公开数据库仓库未见独立分发许可。这里只执行隔离研究资格；权重/数据库随产品分发或正式使用的依据须独立记录，不能由一次技术对照 PASS 推导授权，也不自行联系外部维护者。
