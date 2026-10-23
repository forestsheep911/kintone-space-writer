#!/usr/bin/env python3
"""Fixed tool dispatch inside the plugin's isolated Python environment."""
from __future__ import annotations

import json
import os
import runpy
import sys
from pathlib import Path


def main() -> int:
    if sys.prefix == sys.base_prefix:
        print("error: Use run.ps1 or run.sh to enter the plugin's isolated environment.", file=sys.stderr)
        return 1
    root = Path(__file__).resolve().parent.parent
    arguments = sys.argv[1:]
    tool = arguments[0] if arguments else ""
    if tool == "doctor":
        import yaml

        manifest = json.loads((root / ".codex-plugin/plugin.json").read_text(encoding="utf-8"))
        print(json.dumps({
            "pluginVersion": manifest["version"],
            "pythonVersion": sys.version.split()[0],
            "executable": sys.executable,
            "environment": sys.prefix,
            "basePython": sys.base_prefix,
            "pyyamlVersion": yaml.__version__,
            "pluginRoot": str(root),
            "workspace": os.getcwd(),
            "runtimeHome": os.environ.get("KSW_RUNTIME_HOME", ""),
        }, ensure_ascii=False, indent=2))
        return 0
    scripts = {"bridge": "kintone_article_bridge.py", "rest": "kintone_space_comment.py"}
    if tool not in scripts:
        print("error: Expected doctor, bridge, or rest.", file=sys.stderr)
        return 1
    script = root / "scripts" / scripts[tool]
    sys.argv = [str(script), *arguments[1:]]
    runpy.run_path(str(script), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
