#!/usr/bin/env python3
"""Build a source plugin delivery ZIP with an optional verified uv executable."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins/kintone-space-writer"


def main() -> int:
    runtime = json.loads((PLUGIN / "runtime/uv-manifest.json").read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["portable", *runtime["platforms"]], default="windows-x86_64")
    args = parser.parse_args()
    manifest = json.loads((PLUGIN / "plugin.json").read_text(encoding="utf-8"))
    legacy = json.loads((PLUGIN / ".codex-plugin/plugin.json").read_text(encoding="utf-8"))
    assert manifest["version"] == legacy["version"]
    assert manifest["extensions"]["com.openai"]["interface"] == legacy["interface"]
    assert len(legacy["interface"]["shortDescription"]) <= 30
    files: dict[str, bytes] = {}
    for name in ["plugin.json", ".codex-plugin/plugin.json", "pyproject.toml", "uv.lock", ".python-version", ".env.example", "kintone-targets.example.yaml", "INSTALL.md"]:
        files[name] = (PLUGIN / name).read_bytes()
    for directory in ["scripts", "skills", "assets", "runtime"]:
        for path in (PLUGIN / directory).rglob("*"):
            if not path.is_file() or path.is_symlink():
                continue
            relative = path.relative_to(PLUGIN)
            if "__pycache__" in relative.parts or "bin" in relative.parts or path.name.startswith("test_") or path.suffix in (".pyc", ".pyo"):
                continue
            files[relative.as_posix()] = path.read_bytes()
    if args.target != "portable":
        asset = runtime["platforms"][args.target]
        vendor = ROOT / "local-runs/uv-vendor"
        vendor.mkdir(parents=True, exist_ok=True)
        archive_path = vendor / asset["url"].rsplit("/", 1)[-1]
        if not archive_path.exists() or hashlib.sha256(archive_path.read_bytes()).hexdigest() != asset["archiveSha256"]:
            with urllib.request.urlopen(asset["url"], timeout=180) as response:
                archive_path.write_bytes(response.read())
        archive = archive_path.read_bytes()
        if hashlib.sha256(archive).hexdigest() != asset["archiveSha256"]:
            raise RuntimeError("uv archive checksum mismatch")
        if archive_path.suffix == ".zip":
            with zipfile.ZipFile(io.BytesIO(archive)) as z:
                executable = z.read(asset["member"])
        else:
            with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as t:
                executable = t.extractfile(asset["member"]).read()
        if hashlib.sha256(executable).hexdigest() != asset["executableSha256"]:
            raise RuntimeError("uv executable checksum mismatch")
        name = "uv.exe" if args.target.startswith("windows-") else "uv"
        files[f"runtime/bin/{args.target}/{name}"] = executable
    # Explicit allowlist above excludes the plugin checkout's real .env and targets.
    assert ".env" not in files and "kintone-targets.yaml" not in files
    delivery = {"pluginVersion": manifest["version"], "target": args.target, "uvVersion": runtime["uvVersion"], "pythonVersion": runtime["pythonVersion"],
                "files": {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}}
    files["delivery-manifest.json"] = (json.dumps(delivery, indent=2) + "\n").encode()
    destination = ROOT / "dist" / f"kintone-space-writer-plugin-v{manifest['version']}-{args.target}.zip"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(f"kintone-space-writer/{name}", date_time=(2026, 10, 23, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            executable = name.endswith("run.sh") or "/bin/" in name
            entry.external_attr = (0o100755 if executable else 0o100644) << 16
            z.writestr(entry, data)
    with zipfile.ZipFile(destination) as z:
        assert z.testzip() is None
    receipt = {"version": manifest["version"], "target": args.target, "bytes": destination.stat().st_size,
               "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(), "files": len(files), "firstUseNeedsNetwork": True}
    Path(str(destination) + ".json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"package": str(destination), **receipt}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
