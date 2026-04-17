# -*- coding: utf-8 -*-
"""One-off: emit EmbyDesktopPlayer_PRD_v1.0.0_structured.md from the canonical PRD."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "archive" / "EmbyDesktopPlayer_PRD_v1.0.0.md"
DST = ROOT / "archive" / "EmbyDesktopPlayer_PRD_v1.0.0_structured.md"

# Split on top-level ## headings (numeric sections 0-16 only), keep headings in parts
MAIN = re.compile(r"\n(?=## [0-9]+\.)")


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(
            f"Missing legacy PRD at {SRC}. Copy EmbyDesktopPlayer_PRD_v1.0.0.md into archive/ locally."
        )
    raw = SRC.read_text(encoding="utf-8")
    if not raw.startswith("# "):
        raise SystemExit("unexpected file start")
    # Remove first line (title) — we replace with structured title
    first_nl = raw.index("\n")
    body = raw[first_nl + 1 :]

    parts = MAIN.split(body)
    # parts[0] may be empty or whitespace before ## 0
    section_blocks: list[tuple[str, str]] = []
    for chunk in parts:
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        m = re.match(r"(## [0-9]+\.[^\n]*)", chunk)
        if not m:
            continue
        heading = m.group(1)
        section_blocks.append((heading, chunk))

    toc_rows = [
        "| 分篇 | 涵盖主题 | 对应原版章节 |",
        "|------|----------|--------------|",
        "| **A** | 元信息、修订历史、SSOT 关系 | §0 |",
        "| **B** | 产品定位、目标、非目标 | §1 |",
        "| **C** | 五页信息架构、页面职责 | §2、§3 |",
        "| **D** | 星级、目标码率、等效换算、豆瓣、推荐动作 | §4 全文 |",
        "| **E** | 治理动作、补源刷新 | §5、§6 |",
        "| **F** | 调度、执行模式、删除 Flow、批量提示 | §7 |",
        "| **G** | 进程架构、资源、托盘；状态机与恢复 | §8、§9 |",
        "| **H** | MoviePilot 联动 | §10 |",
        "| **I** | 总流程图、验收、风险 | §11、§12、§13 |",
        "| **J** | beta 历史、版本结论 | §14、§15 |",
        "| **K** | 附录：前台 MVP 基线 | §16 |",
    ]

    header = f"""# Emby Desktop Player PRD（v1.0.0 正式版 · 结构化编排）

> **与 `EmbyDesktopPlayer_PRD_v1.0.0.md` 的关系**：两文**技术条文完全等价**（未删减、未改写事实性内容）；本文件仅增加**分篇导航、阅读路线与章节分组表**，便于按主题检索。  
> **SSOT**：任务调度与任务中心交互以 `TASK_CENTER_FULL_LOGIC.md` 为准；与 SSOT 冲突时以 SSOT 为准。

## 阅读路线（建议顺序）

1. **A → B → C**：产品边界与五页架构。  
2. **D**：媒体策略（星级 / H265 等效 / 豆瓣 / 推荐动作）——与实现 `mediaManager` 最相关。  
3. **E → F → G**：从治理动作到调度与工程可靠性。  
4. **H**：补源与 MoviePilot。  
5. **I**：端到端流程、验收与风险。  
6. **J → K**：版本演进与前台播放闭环附录。

## 分篇总览

{chr(10).join(toc_rows)}

## 章节编号对照（结构化分篇 ↔ 原版）

| 结构化分篇 | 原版 `EmbyDesktopPlayer_PRD_v1.0.0.md` |
|------------|----------------------------------------|
| A | §0 |
| B | §1 |
| C | §2、§3 |
| D | §4 |
| E | §5、§6 |
| F | §7 |
| G | §8、§9 |
| H | §10 |
| I | §11、§12、§13 |
| J | §14、§15 |
| K | §16 |

---

"""

    # Map section number to letter prefix
    def wrap_section(heading_line: str, content: str) -> str:
        m = re.match(r"## ([0-9]+)\.", heading_line)
        if not m:
            return content
        n = int(m.group(1))
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        # §0 -> A, §1 -> B, ... §16 -> K
        if 0 <= n <= 16:
            letter = letters[n]  # 0=A, 1=B, ... but we want 0=A: letters[0]=A yes
        else:
            letter = "?"
        labels = {
            0: "A 元信息与修订历史",
            1: "B 产品定位与目标",
            2: "C 页面清单与职责关系",
            3: "C（续）页面职责与关系",
            4: "D 星级、目标码率与等效策略（§4 全文）",
            5: "E 媒体库治理动作",
            6: "E（续）补源刷新策略",
            7: "F 调度与执行模式",
            8: "G 前后台双轨技术方案",
            9: "G（续）任务状态机与中断恢复",
            10: "H 与 MoviePilot 联动",
            11: "I 用户操作流程",
            12: "I（续）验收标准",
            13: "I（续）风险与缓解",
            14: "J beta 版本能力简述",
            15: "J（续）版本结论",
            16: "K 附录：MVP 基线补充",
        }
        label = labels.get(n, "")
        banner = f"\n<!-- 分篇：{label} · 原版 §{n} -->\n\n"
        return banner + content

    out_parts = [header]
    for heading, block in section_blocks:
        out_parts.append(wrap_section(heading, block))
        out_parts.append("\n\n---\n\n")

    text = "".join(out_parts).rstrip() + "\n"
    DST.write_text(text, encoding="utf-8")
    print(f"Wrote {DST.relative_to(ROOT)} ({len(text)} chars)")


if __name__ == "__main__":
    main()
