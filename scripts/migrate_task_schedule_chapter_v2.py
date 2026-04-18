# -*- coding: utf-8 -*-
"""Current-repo layout: promote 2.3–2.5 to §4–§6, insert §3 任务调度, merge old §3–§5 §7."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "TASK_CENTER_FULL_LOGIC.md"

SLIM_CH2 = """## 2. 术语与引用约定

### 2.1 任务调度 vs 任务 Flow（摘要）

- **任务调度（动作）**：调度层对已入池任务在运行时的 **准许推进、排队次序、占槽与分队列 FIFO** 等 **决策与记账**；**边界与含义** 见 **§3.1**，与 Flow 的 **职责对照** 见 **§3.2**。
- **任务 Flow**：绑定在某一 `actionType` 上的步骤、分支与专有停泊规则；**三种治理类型与三条逻辑队列** 见 **§3.3**。

"""

SCHEDULE = """## 3. 任务调度

本节整合 **调度层** 在运行时的技术条文：任务记录形状、槽与 `status`、逻辑队列、入池与移除等。**用户操作**「执行 / 暂停 / 移除」见 **§8–§10**；各 `actionType` 的 **Flow 步骤** 见 **§4–§6**；**配置中心** 见 **§7**。

### 3.1 任务调度（动作）在本文中的含义

**调度** 在口语中可泛指向「何时跑任务」；在本文 **SSOT** 中，**任务调度（动作）** 特指调度层对已 **入池** 的任务记录所做的一组 **运行时决策与记账**，包括：

- **准许与否**：是否允许任务处于 **可排队等槽 / 可占槽推进**（与 **`pending_manual`**、**`queued`**、执行模式在「添加瞬间」写入的初始态一致；细则见 **§3.5–§3.7**）。
- **队列次序**：在 **`delete` / `transcode` / `upgrade` 三条逻辑队列** 内分别 **FIFO**（见 **§3.3**）。
- **槽位与停泊语义**：**活跃执行槽 / 排队等槽 / 停泊** 的划分见 **§3.5.1**；与配置项对应的并发上限见 **§7.2**。

**不在**「任务调度」边界内：各 Flow 的 **业务步骤**（压制参数、replace 链、MoviePilot 调用等）、**用户显式操作** 的完整语义（**§8–§10**）、以及 **配置表单** 的页面结构（**§7**）。若指「按日历/窗口允许跑任务」，见 **§7.4**（定时 / 时间窗口），与上文 **运行时调度决策** 正交。

### 3.2 调度层与任务 Flow 的职责边界

| 维度   | 调度层                                                            | 任务 Flow                                                           |
| ---- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| 负责内容 | 入池/出池；同视频互斥；并发槽；手动/自动下 **是否准许推进**；**按 `actionType` 分队列** 的 FIFO | 步骤顺序、分支；**各类型专有**（如补源 `waiting_media_source`、删除的确认与回收步骤、转码的编码校验等） |
| 典型问题 | 能否添加入池？能否占槽？是否冻结？                                               | 这一步做完下一步是什么？                                                      |

**原则**：调度 **不得** 绕过 Flow 门槛；Flow **不得** 单方面无视并发上限。通过状态字段与 API 契约协作。

### 3.3 三种治理类型与三条逻辑队列

产品将可入池的 **治理动作** 统一为 **三种任务类型**，各自 **一条独立 Flow**（业务规则只在 **该 Flow** 内定义）；调度层为其各维护 **一条逻辑队列**（严格 **FIFO**，各自并发上限见 **§7.2**；键名以实现与配置中心为准）。

| `actionType` | 用户语义（示例）      | Flow 要点（摘要）                                                      |
| ------------ | ------------- | ---------------------------------------------------------------- |
| `delete`     | 从库中移除该片（删除档等） | **仅经 Emby 删除条目**；步骤与 `status` 见 **§4**                         |
| `transcode`  | 码率压缩          | 预检 → 编码执行 → 校验 →（可选替换前确认）→ **replace 子流程**（见 **§5**）           |
| `upgrade`    | 洗版 / 补源提升     | **§6**：MoviePilot、码率估算与排序、`waiting_media_source` 字段与重搜节奏、落盘与校验 |

策略上的 **保留 / 已达目标** **不入任务池**，不对应 Flow。

**队列与习惯**：三条队列与上表 **一一对应**。**同视频互斥**（§3.7.2）避免同 `itemId` 多条未结案并行；多队列用于 **按类型隔离容量**。**默认处理习惯（非抢占优先级）**：实现 **不** 做队列内抢占（PRD §7.5）。**未来扩展**：新 `actionType` →新队列 + 独立并发 +独立 Flow 说明。

**实现备忘**：调度 `refresh`、Flow 回调与进程分工见 **§13**；协作关系见 **§14**。

### 3.4 任务记录与调度相关字段（逻辑）

- **id**：任务唯一标识。
- **itemId**：Emby 媒体条目；互斥与展示均按 **视频维度**。
- **itemName**：展示。
- **actionType**：`delete` | `transcode` | `upgrade`。业务假设：同一视频 **任意时刻至多一条未结案治理任务**；互斥 **不区分** 类型。
- **status**：扁平枚举，**不使用 `phase` 子字段**。
- **progress / createdAt / updatedAt**。
- **retryCount**：洗版重试、或其它 Flow 通用重试计数（以实现为准）。  
- `**lastSearchAt` / `nextSearchAt` / `searchAttempt` / `bestCandidateScore`**：主要为 `**upgrade`** 在 `**waiting_media_source**` 阶段使用（§6.3）。  
- `**pre_replace_hash**`（可选）：仅 `**transcode**` 在 replace 前对 **旧版目标文件** 的摘要（§5.4）。  
- 其他类型可按需扩展字段；调度仅消费「是否可回排队」等与调度相关的信号。

### 3.5 状态、停泊、槽位与用户可见展示

#### 3.5.1 三类调度语义

| 概念       | 含义                             | 用户可见示例                                     |
| -------- | ------------------------------ | ------------------------------------------ |
| **停泊**   | 不占活跃执行槽，且不在「已获准、排队等槽」的就绪队      | 待启动、待信息确认、`waiting_media_source`、已暂停（冻结后）等 |
| **排队等槽** | 已获准调度，等待并发空位                   | 排队中                                        |
| **占槽**   | 占用该类型 Flow 的执行名额（转码/洗版/删除各自计数） | 预检中、执行中、校验中（`verify`）                      |

**关键**：各类型并发配置表示 **同时占槽** 的任务数上限，**不是** 「未结案任务数」。`waiting_media_source`、`awaiting_user_confirm`、`pending_manual`（未发令）等 **不占槽或释槽** 语义由各 Flow 与 **§3.5.3** 对表。

#### 3.5.2 `waiting_media_source`

表示等待 **媒体片源 / 补源资源**（或未到再搜时间），**不是** 「等执行槽」。旧名 `waiting_source` 应迁移为 `waiting_media_source`。

#### 3.5.3 内部 `status` 与展示（摘要）

**共用（转码/补源均可出现）**：

| 内部 `status`                         | 用户可见（示例）        | 停泊？ | 槽位            |
| ----------------------------------- | --------------- | --- | ------------- |
| `pending_manual`                    | 待启动             | 是   | 不占、不发令则不推进    |
| `queued`                            | 排队中             | 否   | 排队等槽          |
| `precheck` / `executing` / `verify` | 预检中 / 执行中 / 校验中 | 否   | 占槽            |
| `paused`                            | 已暂停             | 是   | 不占（软停：占槽步结束后） |
| `interrupted` / `resume_pending`    | 已中断 / 待恢复       | 视实现 | 对表            |
| `done` / `failed_hard`              | 已完成 / 已失败       | —   | 结案            |

**洗版专有**：`waiting_media_source`（停泊）。**信息确认**：`awaiting_user_confirm`（停泊）；出现次数由 **各 Flow** 定义，调度层只识别 **不占槽 / 不自动推进** 直至确认完成。

### 3.7 添加入口、互斥、原盘拦截与从任务中心移除

#### 3.7.1 添加入口（三种）

1. **媒体库 · 单条**
2. **媒体库 · 批量**
3. **海报墙 · 观看后打分**（受 §7.3 开关控制）

**移除**：观看历史中「添加任务」类入口取消（与媒体库重复）。

#### 3.7.2 同视频互斥（须在后端/主进程入队 API 强制执行）

- 若存在任意 **未结案** 任务（`status` 非 `done` / `failed_hard`），**禁止** 为该 `itemId` 再创建任务。前端可预校验，**不能** 作为唯一保障。

#### 3.7.2.1 原盘类资源不得入队（与 PRD §5.4.0 对表）

- **定义**：资源为 `**.iso` 映像**，或磁盘上存在 `**BDMV` 目录结构**（含 Emby 路径经 **pathMap** 映射后在本机可验证的情形），视为 **原盘类**。  
- **规则**：原盘类 **禁止** 创建 `**transcode`** 与 `**upgrade`** 任务；入队 API **须拒绝** 并返回明确错误；UI **单条提示**、**批量跳过并汇总**；用户需先提取或转封装为常规片源后再治理。

#### 3.7.3 从任务中心「移除」任务（非删除类 Flow）

> 本节指用户将某条 **任务记录** 从调度池 **移除**，**不是** **§4** 中 `**actionType: delete` 的媒体删除 Flow**。

- **调度**：该任务从可调度集合 **移除**（实现可物理删记录或归档）。
- **Flow/业务回滚**：若任务已产生副作用（文件、元数据等），回滚 **范围与失败策略** 另文细化；本文仅要求产品与后端对 **移除** 与 **暂停** 区分清楚。

"""


def protect_prd(text: str) -> tuple[str, list[str]]:
    refs: list[str] = []

    def cap(m: re.Match[str]) -> str:
        refs.append(m.group(0))
        return f"\ue000{len(refs) - 1}\ue001"

    text = re.sub(r"PRD §[\d.]+", cap, text)
    return text, refs


def restore_prd(text: str, refs: list[str]) -> str:
    for i, s in enumerate(refs):
        text = text.replace(f"\ue000{i}\ue001", s)
    return text


def promote_flow_block(block: str) -> str:
    block = block.replace("### 2.5 ", "## 6. ")
    for i in range(6, 0, -1):
        block = block.replace(f"#### 2.5.{i} ", f"### 6.{i} ")
    block = block.replace("### 2.4 ", "## 5. ")
    for i in range(11, 0, -1):
        block = block.replace(f"#### 2.4.{i} ", f"### 5.{i} ")
    block = block.replace("### 2.3 ", "## 4. ")
    for i in range(5, 0, -1):
        block = block.replace(f"#### 2.3.{i} ", f"### 4.{i} ")
    return block


def replace_header_index(text: str) -> str:
    old = (
        "**技术条文索引**：`transcode` → **§2.4**、**§17**；`upgrade` → **§2.5**；`delete` → **§2.3**（含 **§2.3.5** HTTP/鉴权）；"
        "checkpoint / 幂等 / v1 恢复 → **§18**；进程分层、观影降载与磁盘阈值 → **§13.1**；跨页用户旅程示意（mermaid）→ **§19**。"
    )
    new = (
        "**技术条文索引**：**任务调度** → **§3**；`transcode` → **§5**、**§17**；`upgrade` → **§6**；`delete` → **§4**（含 **§4.5** HTTP/鉴权）；"
        "checkpoint / 幂等 / v1 恢复 → **§18**；进程分层、观影降载与磁盘阈值 → **§13.1**；跨页用户旅程示意（mermaid）→ **§19**。"
    )
    if old not in text:
        raise SystemExit("header index not found")
    return text.replace(old, new, 1)


def remap_section_refs(text: str) -> str:
    """Config §6.x → §7.x must run before Flow §2.5.x → §6.x."""
    seq: list[tuple[str, str]] = []

    def p(a: str, b: str) -> None:
        seq.append((a, b))

    p("§7.2.1", "§3.7.2.1")
    p("§7.2", "§3.7.2")
    p("§7.3", "§3.7.3")
    p("§7.1", "§3.7.1")
    p("§6.4", "§7.4")
    p("§6.3", "§7.3")
    p("§6.2", "§7.2")
    p("§6.1", "§7.1")
    p("§4.3", "§3.5.3")
    p("§4.2", "§3.5.2")
    p("§4.1", "§3.5.1")
    for i in range(11, 0, -1):
        p(f"§2.4.{i}", f"§5.{i}")
    for i in range(5, 0, -1):
        p(f"§2.3.{i}", f"§4.{i}")
    for i in range(6, 0, -1):
        p(f"§2.5.{i}", f"§6.{i}")
    p("§2.5", "§6")
    p("§2.4", "§5")
    p("§2.3", "§4")
    for old, new in seq:
        text = text.replace(old, new)

    text = re.sub(r"§7(?!\.\d)", "§3.7", text)
    text = re.sub(r"§5(?!\.\d)", "§3.3", text)
    text = re.sub(r"§6(?!\.\d)", "§7", text)
    text = text.replace("（§3）", "（§3.4）").replace("§2.1", "§3.3")
    return text


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    text, prd = protect_prd(text)
    text = replace_header_index(text)

    m = re.search(r"\n(### 2\.3 .*)(?=\n## 3\. 任务数据模型)", text, re.DOTALL)
    if not m:
        raise SystemExit("flow block not found")
    flow_raw = m.group(1)
    text = text[: m.start()] + text[m.end() :]

    text = re.sub(
        r"## 2\. 术语：任务调度 vs 任务 Flow\n.*?(?=\n### 2\.2 )",
        SLIM_CH2,
        text,
        count=1,
        flags=re.DOTALL,
    )

    anchor = "## 3. 任务数据模型（逻辑）"
    idx = text.find(anchor)
    if idx < 0:
        raise SystemExit("task model heading not found")
    text = text[:idx] + SCHEDULE + "\n\n" + promote_flow_block(flow_raw) + "\n\n" + text[idx:]

    text = re.sub(
        r"\n## 3\. 任务数据模型（逻辑）\n.*?"
        r"\n## 4\. 状态、用户可见文案、停泊与槽位\n.*?"
        r"\n## 5\. 多逻辑队列（删除 / 转码 / 洗版）\n.*?"
        r"(?=\n## 6\. 配置中心)",
        "",
        text,
        flags=re.DOTALL,
    )

    text = re.sub(
        r"\n## 7\. 任务添加与删除\n.*?(?=\n## 8\. 用户操作)",
        "",
        text,
        flags=re.DOTALL,
    )

    text = re.sub(r"^## 6\. 配置中心", "## 7. 配置中心", text, flags=re.MULTILINE)
    text = re.sub(r"^### 6\.(\d)", r"### 7.\1", text, flags=re.MULTILINE)

    text = remap_section_refs(text)
    text = restore_prd(text, prd)

    PATH.write_text(text, encoding="utf-8", newline="\n")
    print("OK", PATH)


if __name__ == "__main__":
    main()
