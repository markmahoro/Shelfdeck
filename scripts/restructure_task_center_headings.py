# -*- coding: utf-8 -*-
"""Move §2.3/2.4/2.5 Flow blocks to top-level §3/4/5; bump former §3–§20 to §6–§23.

Order matters: bump §3..§20 references *before* rewriting §2.3.x→§3.x so §4.1 (状态)
does not collide with new transcode §4.1.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "docs" / "design" / "DESIGN_TASK_CENTER.md"


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    prd_refs: list[str] = []

    def protect_prd(m: re.Match[str]) -> str:
        prd_refs.append(m.group(0))
        return f"\ue000{len(prd_refs) - 1}\ue001"

    text = re.sub(r"PRD §[\d.]+", protect_prd, text)

    def bump_doc_section(m: re.Match[str]) -> str:
        n = int(m.group(1))
        tail = m.group(2) or ""
        if 3 <= n <= 20:
            return f"§{n + 3}{tail}"
        return m.group(0)

    text = re.sub(r"§(3|4|5|6|7|8|9|1\d|20)((?:\.\d+)*)", bump_doc_section, text)

    ref_pairs: list[tuple[str, str]] = []
    for a in range(12, 0, -1):
        ref_pairs.append((f"§2.4.{a}", f"§4.{a}"))
    ref_pairs.extend(
        [
            ("§2.4.1.2", "§4.1.2"),
            ("§2.4.1.1", "§4.1.1"),
            ("§2.4.3.2", "§4.3.2"),
            ("§2.4.3.1", "§4.3.1"),
            ("§2.4.1", "§4.1"),
            ("§2.4.3", "§4.3"),
            ("§2.4.x", "§4.x"),
        ]
    )
    for i in range(6, 0, -1):
        ref_pairs.append((f"§2.5.{i}", f"§5.{i}"))
    for i in range(5, 0, -1):
        ref_pairs.append((f"§2.3.{i}", f"§3.{i}"))
    ref_pairs.extend([("§2.5", "§5"), ("§2.4", "§4"), ("§2.3", "§3")])

    for old, new in ref_pairs:
        text = text.replace(old, new)

    for old in range(20, 2, -1):
        new = old + 3
        text = re.sub(rf"^## {old}\. ", f"## {new}. ", text, flags=re.MULTILINE)
        text = re.sub(
            rf"^### {old}\.(\d+(?:\.\d+)*)(?=\s)",
            rf"### {new}.\1",
            text,
            flags=re.MULTILINE,
        )
        text = re.sub(
            rf"^#### {old}\.(\d+(?:\.\d+)*)(?=\s)",
            rf"#### {new}.\1",
            text,
            flags=re.MULTILINE,
        )

    text = text.replace(
        "### 2.3 删除 Flow（`actionType: delete`）— 仅经 Emby、步骤与 `status`",
        "## 3. 删除 Flow（`actionType: delete`）— 仅经 Emby、步骤与 `status`",
    )
    for i in range(1, 6):
        text = text.replace(f"#### 2.3.{i} ", f"### 3.{i} ")

    text = text.replace(
        "### 2.4 转码 Flow（`actionType: transcode`）— 执行步骤、替换与异常对表",
        "## 4. 转码 Flow（`actionType: transcode`）— 执行步骤、替换与异常对表",
    )
    text = text.replace("#### 2.4.1 ", "### 4.1 ")
    text = text.replace("##### 2.4.1.1 ", "#### 4.1.1 ")
    text = text.replace("##### 2.4.1.2 ", "#### 4.1.2 ")
    for i in range(2, 13):
        text = text.replace(f"#### 2.4.{i} ", f"### 4.{i} ")
    text = text.replace("#### 2.4.3.1 ", "#### 4.3.1 ")
    text = text.replace("#### 2.4.3.2 ", "#### 4.3.2 ")

    text = text.replace(
        "### 2.5 洗版 Flow（`actionType: upgrade`）— 补源、`waiting_media_source`与 MoviePilot",
        "## 5. 洗版 Flow（`actionType: upgrade`）— 补源、`waiting_media_source`与 MoviePilot",
    )
    for i in range(1, 7):
        text = text.replace(f"#### 2.5.{i} ", f"### 5.{i} ")

    for i, s in enumerate(prd_refs):
        text = text.replace(f"\ue000{i}\ue001", s)

    PATH.write_text(text, encoding="utf-8", newline="\n")
    print("Updated", PATH)


if __name__ == "__main__":
    main()
