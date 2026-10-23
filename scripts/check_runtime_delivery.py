#!/usr/bin/env python3
"""Windows delivery integration check; first use downloads private managed Python."""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import pathlib
import socket
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    if os.name != "nt":
        raise RuntimeError("This acceptance check targets Windows x64; use native platform checks elsewhere.")
    run_root = ROOT / "local-runs/runtime-delivery"
    run_root.mkdir(parents=True, exist_ok=True)
    run = pathlib.Path(tempfile.mkdtemp(prefix="run-", dir=run_root))
    package = ROOT / "dist/kintone-space-writer-plugin-v0.3.0-windows-x86_64.zip"
    with zipfile.ZipFile(package) as z:
        assert z.testzip() is None
        assert all(not pathlib.PurePosixPath(n).is_absolute() and ".." not in pathlib.PurePosixPath(n).parts for n in z.namelist())
        z.extractall(run / "installed plugin")
    plugin = run / "installed plugin/kintone-space-writer"
    workspace = run / "article workspace \u6d4b\u8bd5"
    workspace.mkdir()
    (workspace / "assets").mkdir()
    (workspace / ".venv").mkdir()
    (workspace / ".venv/do-not-touch.txt").write_text("existing project environment", encoding="utf-8")
    (workspace / ".venv/yaml.py").write_text("raise RuntimeError('The article environment must not be imported')", encoding="utf-8")
    runtime_home = run / "private runtime \u9996\u6b21"
    environment = os.environ.copy()
    system = pathlib.Path(environment["SYSTEMROOT"])
    environment.update(PATH=str(system / "System32"), KSW_RUNTIME_HOME=str(runtime_home), KSW_PYTHON_SOURCE="managed")
    environment["PYTHONPATH"] = str(workspace / ".venv")
    environment.pop("VIRTUAL_ENV", None)
    powershell = system / "System32/WindowsPowerShell/v1.0/powershell.exe"
    command = [str(powershell), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(plugin / "scripts/run.ps1")]
    checks: list[str] = []
    invocations: list[dict] = []

    def invoke(*arguments: str, offline: bool = False, success: bool = True, overrides: dict | None = None) -> subprocess.CompletedProcess:
        child_env = environment.copy()
        child_env.update(overrides or {})
        if offline:
            child_env["UV_OFFLINE"] = "true"
        start = time.monotonic()
        result = subprocess.run([*command, *arguments], cwd=workspace, env=child_env, capture_output=True, text=True, encoding="utf-8", timeout=360)
        invocations.append({"arguments": arguments, "exitCode": result.returncode, "seconds": round(time.monotonic() - start, 2), "stderr": result.stderr})
        if success:
            assert result.returncode == 0, result.stderr
        else:
            assert result.returncode != 0, "Expected failure"
        return result

    before = {p.relative_to(plugin).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in plugin.rglob("*") if p.is_file()}
    try:
        delivery = json.loads((plugin / "delivery-manifest.json").read_text(encoding="utf-8"))
        assert all(before[name] == digest for name, digest in delivery["files"].items())
        assert ".env" not in before and "kintone-targets.yaml" not in before
        checks += ["zip-integrity-and-per-file-receipt", "real-credentials-and-target-settings-excluded"]
        print("Checking first use with Python/uv absent from PATH and managed Python initially absent...", flush=True)
        first = json.loads(invoke("doctor").stdout)
        assert first["pythonVersion"] == "3.13.13" and first["pyyamlVersion"] == "6.0.3"
        assert pathlib.Path(first["basePython"]).is_relative_to(runtime_home / "python")
        assert pathlib.Path(first["environment"]).is_relative_to(runtime_home / "environments")
        assert pathlib.Path(first["workspace"]) == workspace
        assert first["pluginVersion"] == "0.3.0"
        checks += ["first-use-without-system-python-or-uv", "managed-python-downloaded-privately", "locked-pyyaml-in-private-venv", "space-and-chinese-paths-and-cwd-preserved"]
        checks.append("inherited-pythonpath-cannot-import-article-environment")
        print("First use passed; checking offline reuse and concurrent entry...", flush=True)
        warm = json.loads(invoke("doctor", offline=True).stdout)
        assert warm["executable"] == first["executable"]
        checks.append("warm-runtime-reused-offline")
        system_doctor = json.loads(invoke("doctor", overrides={"KSW_RUNTIME_HOME": str(run / "system-python-profile"), "KSW_PYTHON_SOURCE": "auto", "PATH": os.environ["PATH"]}).stdout)
        assert pathlib.Path(system_doctor["basePython"]).samefile(sys.base_prefix)
        assert pathlib.Path(system_doctor["environment"]).is_relative_to(run / "system-python-profile/environments")
        checks.append("existing-system-python-reused-with-private-packages")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            concurrent_doctors = list(pool.map(lambda _: json.loads(invoke("doctor", offline=True).stdout), range(2)))
        assert all(item["environment"] == first["environment"] for item in concurrent_doctors)
        checks.append("concurrent-launchers-reuse-one-environment")
        article = {"schema": "kintone-rich-article.v1", "id": "delivery-check", "version": "v001", "title": "Delivery check", "blocks": [{"type": "paragraph", "text": "Fixture only"}]}
        (workspace / "article.rich.json").write_text(json.dumps(article), encoding="utf-8")
        # Stay outside the extension discovery range so an open real browser
        # cannot poll this fixture or keep it alive during the idle check.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            fixture_port = str(probe.getsockname()[1])
        assert int(fixture_port) > 8807
        ready = json.loads(invoke("bridge", "mark-ready", "--workspace", ".", "--article", "article.rich.json", "--assets-root", "assets", "--idle-timeout", "8", "--port-start", fixture_port, "--port-end", fixture_port, offline=True).stdout)
        state_file = workspace / "local-runs/kintone-space-writer/bridge.json"
        state = json.loads(state_file.read_text(encoding="utf-8"))
        with urllib.request.urlopen(f"http://127.0.0.1:{state['port']}/health", timeout=2) as response:
            health = json.load(response)
        assert health["instanceId"] == state["instanceId"]
        listing = json.loads(invoke("bridge", "list", "--workspace", ".", offline=True).stdout)
        assert listing[0]["id"] == ready["id"]
        reused = json.loads(invoke("bridge", "ensure-bridge", "--workspace", ".", "--idle-timeout", "8", offline=True).stdout)
        assert reused["pid"] == state["pid"]
        checks += ["article-ready-through-managed-launcher", "bridge-child-starts-with-private-python", "existing-bridge-reused"]
        invoke("rest", "init-targets", offline=True)
        assert (workspace / "kintone-targets.yaml").is_file()
        checks.append("rest-tool-and-yaml-dependency-work-without-posting")
        executable = plugin / "runtime/bin/windows-x86_64/uv.exe"
        original_size = executable.stat().st_size
        with executable.open("ab") as file:
            file.write(b"invalid-checksum")
        failed = invoke("doctor", success=False)
        assert "checksum mismatch" in failed.stderr
        with executable.open("r+b") as file:
            file.truncate(original_size)
        checks.append("corrupt-bundled-uv-is-rejected-before-execution")
        # Exercise the no-bundled-uv branch against an owned local HTTP fixture.
        # Production URLs remain pinned to GitHub; only this extracted test copy changes.
        archive_path = ROOT / "local-runs/uv-vendor/uv-x86_64-pc-windows-msvc.zip"

        class ArchiveHandler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", str(archive_path.stat().st_size))
                self.end_headers()
                with archive_path.open("rb") as file:
                    shutil.copyfileobj(file, self.wfile)

        archive_server = ThreadingHTTPServer(("127.0.0.1", 0), ArchiveHandler)
        archive_thread = threading.Thread(target=archive_server.serve_forever, daemon=True)
        archive_thread.start()
        runtime_manifest = plugin / "runtime/uv-manifest.json"
        original_manifest = runtime_manifest.read_bytes()
        fixture_manifest = json.loads(original_manifest)
        fixture_asset = fixture_manifest["platforms"]["windows-x86_64"]
        expected_archive = fixture_asset["archiveSha256"]
        fixture_asset["url"] = f"http://127.0.0.1:{archive_server.server_port}/uv.zip"
        saved_executable = executable.with_suffix(".saved")
        executable.rename(saved_executable)
        try:
            fixture_asset["archiveSha256"] = "0" * 64
            runtime_manifest.write_text(json.dumps(fixture_manifest), encoding="utf-8")
            failed = invoke("doctor", offline=True, success=False)
            assert "archive checksum mismatch" in failed.stderr
            checks.append("downloaded-uv-archive-checksum-mismatch-is-rejected")
            fixture_asset["archiveSha256"] = expected_archive
            runtime_manifest.write_text(json.dumps(fixture_manifest), encoding="utf-8")
            assert json.loads(invoke("doctor", offline=True).stdout)["executable"] == first["executable"]
            checks.append("portable-uv-download-verify-extract-and-reuse")
        finally:
            runtime_manifest.write_bytes(original_manifest)
            saved_executable.rename(executable)
            archive_server.shutdown()
            archive_server.server_close()
            archive_thread.join(timeout=2)
        project = plugin / "pyproject.toml"
        original_project = project.read_bytes()
        project.write_bytes(original_project.replace(b"PyYAML==6.0.3", b"PyYAML==0.0.0"))
        invoke("doctor", offline=True, success=False)
        project.write_bytes(original_project)
        checks.append("lock-mismatch-fails-without-rewriting-lock-or-installing-globally")
        assert (workspace / ".venv/do-not-touch.txt").read_text(encoding="utf-8") == "existing project environment"
        after = {p.relative_to(plugin).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in plugin.rglob("*") if p.is_file()}
        assert after == before
        checks += ["installed-plugin-tree-remains-unchanged", "article-project-venv-not-used-or-modified"]
        deadline = time.monotonic() + 12
        while state_file.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        assert not state_file.exists(), "Test Bridge did not stop after idle timeout"
        report = {"date": "2026-10-23", "pluginVersion": "0.3.0", "environment": "Windows x64 / Windows PowerShell 5.1; stripped PATH; forced managed Python; not a clean VM", "checks": checks, "doctor": first, "invocations": invocations, "publishedComments": 0, "macLinuxAcceptance": False}
        (run / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"passed": len(checks), "report": str(run / "report.json")}, indent=2))
        return 0
    except Exception as error:
        (run / "failure.json").write_text(json.dumps({"checks": checks, "error": str(error), "invocations": invocations}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Runtime delivery evidence: {run}", flush=True)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
