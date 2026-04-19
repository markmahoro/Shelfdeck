# -*- coding: utf-8 -*-
"""Build REQ_PRODUCT_BASELINE_v1.0.0.md from legacy PRD sections (docs/requirements/)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# 线性版原文置于本地 archive/（不入库）；用于从旧结构再生模块化 PRD
SRC = ROOT / "archive" / "EmbyDesktopPlayer_PRD_v1.0.0.md"
DST = ROOT / "docs" / "requirements" / "REQ_PRODUCT_BASELINE_v1.0.0.md"


def between(text: str, start: str, end: str | None) -> str:
    i = text.find(start)
    if i == -1:
        raise ValueError(start)
    if end is None:
        return text[i:].strip()
    j = text.find(end, i + 1)
    if j == -1:
        return text[i:].strip()
    return text[i:j].strip()


def renumber_headings(block: str, old_prefix: str, new_prefix: str) -> str:
    return block.replace(old_prefix, new_prefix)


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(
            f"Missing legacy PRD at {SRC}. Copy EmbyDesktopPlayer_PRD_v1.0.0.md into archive/ locally to regenerate."
        )
    raw = SRC.read_text(encoding="utf-8")

    s0 = between(raw, "## 0. 文档信息", "## 1.")
    s1 = between(raw, "## 1. 产品定位与目标", "## 2.")
    s2 = between(raw, "## 2. v1.0.0 页面清单", "## 3.")
    s3 = between(raw, "## 3. 页面职责与关系", "## 4.")
    s4_to_44 = between(raw, "## 4. 星级与目标码率策略（H265等效）", "### 4.4 豆瓣")
    s45 = between(raw, "### 4.5 分星级推荐动作（前端策略演算）", "## 5.")
    s5 = between(raw, "## 5. 媒体库治理动作", "## 6.")
    s6 = between(raw, "## 6. 补源刷新策略（v1推荐）", "## 7.")
    s7 = between(raw, "## 7. 调度与执行模式", "## 8.")
    s8 = between(raw, "## 8. 前后台双轨技术方案（v1关键）", "## 9.")
    s9 = between(raw, "## 9. 任务状态机与中断恢复", "## 10.")
    s10 = between(raw, "## 10. 与 MoviePilot 联动方案", "## 11.")
    s11 = between(raw, "## 11. 用户操作流程（v1.0.0）", "## 12.")
    s12 = between(raw, "## 12. 验收标准（v1.0.0）", "## 13.")
    s13 = between(raw, "## 13. 风险与缓解", "## 14.")
    s14 = between(raw, "## 14. beta 版本能力简述（历史基线）", "## 15.")
    s15 = between(raw, "## 15. 版本结论", "## 16.")
    s16 = between(raw, "## 16. 附录：前台播放闭环补充（合并自《PRD（早期独立草案）》）", None)
    s44 = between(raw, "### 4.4 豆瓣「看过」个人评分与有效星级（产品实现）", "### 4.5")

    cfg_1641_raw = between(s16, "**16.4.1 配置项（字段名与实现一致）**", "**16.4.2")
    cfg_1641 = "\n".join(cfg_1641_raw.splitlines()[1:]).strip()

    revision_bullets = [
        ln.strip()
        for ln in s0.splitlines()
        if (ln.strip().startswith("- **修订") or ln.strip().startswith("- **文档合并"))
    ]

    # §2.1 splits for list items
    block_21 = between(s2, "### 2.1 顶层信息架构（五页 + 壳层）", "### 2.2")
    cfg_center_line = between(block_21, "1. **配置中心（Config）**", "2. **未播放")
    wall_line = between(block_21, "2. **未播放海报墙（Wall）**", "3. **播放")
    hist_line = between(block_21, "3. **播放记录页（History）**", "4. **媒体库")
    media_line = between(block_21, "4. **媒体库管理页（MediaManage）**", "5. **任务中心")
    block_21_body = "\n".join(block_21.splitlines()[1:]).strip() if block_21.startswith("### 2.1") else block_21

    s22 = between(s2, "### 2.2 非顶层页面 / 已调整项", None)
    s22_body = "\n".join(s22.splitlines()[1:]).strip() if s22.startswith("### 2.2") else s22

    import re as _re

    # Module C: renumber §16 appendix to 4.3.x
    s16_renum = s16.replace(
        "## 16. 附录：前台播放闭环补充（合并自《PRD（早期独立草案）》）",
        "### 4.3.0 附录总述（原 §16）\n\n> 下列自原 §16 迁入；文中若仍写「§12」「§2」等，指**旧版线性编号**。\n\n",
        1,
    )
    s16_renum = _re.sub(r"^### 16\.(\d+)", r"### 4.3.\1", s16_renum, flags=_re.MULTILINE)
    s16_renum = _re.sub(r"^#### 16\.(\d+)\.(\d+)", r"#### 4.3.\1.\2", s16_renum, flags=_re.MULTILINE)

    s5_renum = s5.replace("## 5. 媒体库治理动作", "### 5.4 媒体库治理动作", 1)
    s5_renum = s5_renum.replace("### 5.0 ", "### 5.4.0 ", 1)
    s5_renum = s5_renum.replace("### 5.1 ", "### 5.4.1 ", 1)
    s5_renum = s5_renum.replace("### 5.2 ", "### 5.4.2 ", 1)
    s5_renum = s5_renum.replace("### 5.3 ", "### 5.4.3 ", 1)

    s44_renum = s44.replace("### 4.4 豆瓣「看过」个人评分与有效星级（产品实现）", "", 1)
    s44_renum = _re.sub(r"^#### 4\.4\.(\d+)", r"### 6.\1", s44_renum.strip(), flags=_re.MULTILINE)

    s7_body = s7.replace("## 7. 调度与执行模式\n\n", "", 1)

    s9_renum = s9.replace("## 9. 任务状态机与中断恢复", "### 7.6 任务状态机与中断恢复", 1)
    s9_renum = s9_renum.replace("### 9.1 ", "### 7.6.1 ", 1)
    s9_renum = s9_renum.replace("### 9.2 ", "### 7.6.2 ", 1)
    s9_renum = s9_renum.replace("### 9.3 ", "### 7.6.3 ", 1)
    s9_renum = s9_renum.replace("### 9.4 ", "### 7.6.4 ", 1)

    s6_renum = s6.replace("## 6. 补源刷新策略（v1推荐）", "### 7.7 补源刷新策略（原 §6，Flow 侧规划）", 1)
    s6_renum = s6_renum.replace("### 6.1 ", "### 7.7.1 ", 1)
    s6_renum = s6_renum.replace("### 6.2 ", "### 7.7.2 ", 1)
    s6_renum = s6_renum.replace("### 6.3 ", "### 7.7.3 ", 1)

    s11_renum = s11.replace("## 11. 用户操作流程（v1.0.0）", "### 7.8 用户操作流程总览（原 §11）", 1)

    s8_renum = s8.replace("## 8. 前后台双轨技术方案（v1关键）", "### 8.1 前后台双轨技术方案", 1)
    s8_renum = s8_renum.replace("### 8.1 ", "### 8.1.1 ", 1)
    s8_renum = s8_renum.replace("### 8.2 ", "### 8.1.2 ", 1)
    s8_renum = s8_renum.replace("### 8.3 ", "### 8.1.3 ", 1)

    s10_renum = s10.replace("## 10. 与 MoviePilot 联动方案", "### 8.2 与 MoviePilot 联动方案", 1)
    s10_renum = s10_renum.replace("### 10.1 ", "### 8.2.1 ", 1)
    s10_renum = s10_renum.replace("### 10.2 ", "### 8.2.2 ", 1)
    s10_renum = s10_renum.replace("### 10.3 ", "### 8.2.3 ", 1)

    s4d = s4_to_44.replace("## 4. 星级与目标码率策略（H265等效）", "### 5.2 星级、目标码率与 H265 等效（原 §4.1～§4.3）", 1)
    s4d = s4d.replace("### 4.1 ", "### 5.2.1 ", 1)
    s4d = s4d.replace("### 4.2 ", "### 5.2.2 ", 1)
    s4d = s4d.replace("### 4.3 ", "### 5.2.3 ", 1)
    s4d = _re.sub(r"^#### 4\.3\.(\d+)", r"#### 5.2.3.\1", s4d, flags=_re.MULTILINE)

    s45_fix = s45.replace("### 4.5 ", "### 5.3 ", 1)

    s1_clean = s1.replace("## 1. 产品定位与目标\n\n", "", 1)
    cfg_center_display = cfg_center_line.replace("1. **配置中心（Config）**：", "").strip()
    wall_display = wall_line.replace("2. **未播放海报墙（Wall）**：", "").strip()
    hist_display = hist_line.replace("3. **播放记录页（History）**：", "").strip()
    media_display = media_line.replace("4. **媒体库管理页（MediaManage）**：", "").strip()
    s3r = (
        s3.replace("## 3. 页面职责与关系\n\n", "", 1)
        .replace("### 3.1 ", "### 2.3.1 ")
        .replace("### 3.2 ", "### 2.3.2 ")
        .replace("### 3.3 ", "### 2.3.3 ")
    )

    out = f"""# Emby Desktop Player PRD（v1.0.0 正式版 · 按模块编排）

> **编排说明**：本文按 **模块 A～G** 重组旧版线性条文；**技术内容自旧版迁移，不删减**。任务调度与任务中心**交互细则**以 `docs/design/DESIGN_TASK_CENTER.md` 为 SSOT。  
> **完整修订列表**见 **附录 A**（§0 仅保留摘要）。

---

## 0. 文档信息

- 产品名：`Emby Desktop Player`
- 平台范围：`Windows`（v1.0.0）
- 本文重点：`v1.0.0 正式版`能力定义与落地方案；与实现细节冲突时，**任务调度与任务中心交互**以 `docs/design/DESIGN_TASK_CENTER.md` 为单一事实来源（SSOT）。
- 兼容说明：文末附 `beta` 能力简述及当前开发中快照。
- **修订摘要**：自 2026-04 起对齐五页壳层、任务中心、媒体库/豆瓣/删除 Flow、H265 等效码率等；**完整修订条目见附录 A**。

---

## 1. 产品定位与目标

{s1_clean}

---

## 2. 模块 A — 壳层与信息架构

### 2.1 顶层信息架构（五页 + 壳层）

{block_21_body}

### 2.2 非顶层页面 / 已调整项

{s22_body}

### 2.3 页面职责与关系（原 §3）

{s3r}

---

## 3. 模块 B — 配置中心

> 聚合「配置中心」在架构中的职责、**原 §16.4.1** 配置字段摘要，以及指向模块 F 的调度类配置说明。

### 3.1 配置中心在顶层架构中的定义（原 §2.1 条 1）

1. **配置中心（Config）**：{cfg_center_display}

### 3.2 前台与治理相关配置字段（原 §16.4.1）

{cfg_1641}

### 3.3 任务调度与补源类配置（指向 §7）

- 执行模式、删除/转码/洗版并发、`wallRatingAutoEnqueue`、补源重试节奏等由**配置中心 → 任务调度与补源**维护；条文见 **§7**（模块 F）。

---

## 4. 模块 C — 前台观影与播放记录

### 4.1 未播放海报墙（原 §2.1 条 2）

2. **未播放海报墙（Wall）**：{wall_display}

### 4.2 播放记录页（原 §2.1 条 3）

3. **播放记录页（History）**：{hist_display}

### 4.3 附录：前台播放闭环基线（原 §16）

{s16_renum}

---

## 5. 模块 D — 媒体库治理（列表、码率策略与治理动作）

> 不含豆瓣专章（**§6**）；不含补源周期策略（**§7.7**，属 Flow）。

### 5.1 媒体库管理页能力摘要（原 §2.1 条 4）

4. **媒体库管理页（MediaManage）**：{media_display}

{s4d}

{s45_fix}

{s5_renum}

---

## 6. 模块 E — 豆瓣「看过」与有效星级（原 §4.4）

{s44_renum}

---

## 7. 模块 F — 任务中心、调度与 Flow 规划

> 任务中心 UI/按钮语义等以 **SSOT** 为准。删除 API 与鉴权见 **§7.3.1**（本节内）。

{s7_body}

{s9_renum}

{s6_renum}

{s11_renum}

---

## 8. 模块 G — 工程架构、集成与后台形态

{s8_renum}

{s10_renum}

---

## 9. 验收标准（v1.0.0）（原 §12）

{s12.replace("## 12. 验收标准（v1.0.0）", "").strip()}

---

## 10. 风险与缓解（原 §13）

{s13.replace("## 13. 风险与缓解", "").strip()}

---

## 11. beta 版本能力简述（原 §14）

{s14.replace("## 14. beta 版本能力简述（历史基线）", "").strip()}

---

## 12. 版本结论（原 §15）

{s15.replace("## 15. 版本结论", "").strip()}

---

## 附录 A — 修订历史（完整条目）

{"\n".join(revision_bullets)}

---

## 附录 B — 旧版章节编号对照

| 旧版线性 PRD 章节 | 本文章节 |
|------------------|----------|
| §0 修订全文 | 附录 A；§0 仅摘要 |
| §1 | §1 |
| §2、§3 | §2（模块 A，含原 §3 为 §2.3） |
| §2.1 配置中心句、§16.4.1 字段 | §3（模块 B） |
| §2.1 海报墙/播放记录、§16 附录 | §4（模块 C） |
| §4（除 §4.4）、§5 | §5（模块 D） |
| §4.4 | §6（模块 E） |
| §7、§6、§9、§11 | §7（模块 F） |
| §8、§10 | §8（模块 G） |
| §12、§13 | §9、§10 |
| §14、§15 | §11、§12 |

"""

    DST.write_text(out, encoding="utf-8")
    print("Wrote", DST, "chars", len(out))


if __name__ == "__main__":
    main()
