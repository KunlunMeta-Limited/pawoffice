#!/usr/bin/env python3
"""AI Office 项目治理入口：调用固定版本的通用中文治理工具。"""

from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


def main() -> int:
    """查找治理框架并保留原始命令行参数。"""
    project_root = Path(__file__).resolve().parent.parent
    configured = os.environ.get("AI_GOVERNANCE_FRAMEWORK")
    candidates = [Path(configured)] if configured else []
    # 实验目录固定在 Workspace_bak 外侧；正式项目应通过环境变量指定框架版本。
    candidates.extend(
        [
            project_root.parent / "framework",
            project_root.parent / "ai-governance-framework",
            Path(r"D:\Workspace\_bak\test\framework"),
        ]
    )
    for candidate in candidates:
        tool = candidate / "tools" / "governance.py"
        if tool.is_file():
            sys.argv[0] = str(tool)
            runpy.run_path(str(tool), run_name="__main__")
            return 0
    print(
        "未找到通用治理工具。请设置 AI_GOVERNANCE_FRAMEWORK，指向治理框架固定版本目录。",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
