from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import kintone_article_bridge as bridge  # noqa: E402


class BridgeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name)
        (self.workspace / "assets").mkdir()
        (self.workspace / "assets" / "chart.png").write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        (self.workspace / "assets" / "chart-detail.png").write_bytes(b"\x89PNG\r\n\x1a\ndetail")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_article(self, version: str, text: str = "正文") -> Path:
        path = self.workspace / f"article-{version}.json"
        path.write_text(
            json.dumps(
                {
                    "schema": bridge.ARTICLE_SCHEMA,
                    "id": "weekly-news",
                    "version": version,
                    "title": "周报",
                    "blocks": [
                        {"type": "paragraph", "text": text},
                        {
                            "type": "imageRow",
                            "images": [
                                {"type": "image", "fileName": "chart.png", "caption": "图 1", "width": 320},
                                {"type": "image", "fileName": "chart-detail.png", "caption": "图 2", "width": 240},
                            ],
                        },
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return path

    def create_package(self, version: str, text: str = "正文") -> dict:
        return bridge.create_ready_package(
            self.workspace,
            self.write_article(version, text),
            self.workspace / "assets",
        )

    def test_ready_package_requires_no_target_configuration(self) -> None:
        package = self.create_package("v1")
        self.assertNotIn("target", package)
        self.assertEqual([package], bridge.ready_packages(self.workspace))

    def test_mark_ready_keeps_each_version_available_for_manual_selection(self) -> None:
        first = self.create_package("v1")
        duplicate = self.create_package("v1")
        self.assertEqual(first["id"], duplicate["id"])
        self.assertEqual(len(list(bridge.packages_dir(self.workspace).glob("*.json"))), 1)

        second = self.create_package("v2", "新版正文")
        stored_first = bridge.read_json(bridge.package_path(self.workspace, first["id"]))
        self.assertEqual(stored_first["status"], "ready")
        self.assertEqual(second["status"], "ready")
        ready = bridge.ready_packages(self.workspace)
        self.assertEqual({package["id"] for package in ready}, {first["id"], second["id"]})

    def test_new_revision_remains_ready_after_previous_revision_is_injected(self) -> None:
        first = self.create_package("v1")
        first["status"] = "injected"
        bridge.atomic_write_json(bridge.package_path(self.workspace, first["id"]), first)

        second = self.create_package("v2", "新版正文")
        ready = bridge.ready_packages(self.workspace)

        self.assertEqual([package["id"] for package in ready], [second["id"]])

    def test_http_ready_claim_asset_and_result_flow(self) -> None:
        package = self.create_package("v1")
        server = bridge.BridgeServer(("127.0.0.1", 0), self.workspace, "test-instance", "test-token")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"

        try:
            request = urllib.request.Request(f"{base}/v1/ready?bridgeToken=test-token")
            with urllib.request.urlopen(request) as response:
                public = json.loads(response.read().decode("utf-8"))
            self.assertEqual(public["id"], package["id"])

            asset_url = f'{public["assets"]["chart.png"]}?bridgeToken=test-token'
            asset_request = urllib.request.Request(asset_url)
            with urllib.request.urlopen(asset_request) as response:
                self.assertEqual(response.headers.get_content_type(), "image/png")
                self.assertTrue(response.read().startswith(b"\x89PNG"))

            claim = json.dumps(
                {
                    "hash": package["hash"],
                    "clientId": "browser-test",
                }
            ).encode("utf-8")
            claim_request = urllib.request.Request(
                f"{base}/v1/packages/{package['id']}/claim?bridgeToken=test-token",
                data=claim,
                method="POST",
            )
            with urllib.request.urlopen(claim_request) as response:
                self.assertEqual(json.loads(response.read())["status"], "claimed")

            result = json.dumps(
                {"hash": package["hash"], "status": "injected", "pageUrl": "https://customer.s.cybozu.cn/k/#/space/10/thread/12"}
            ).encode("utf-8")
            result_request = urllib.request.Request(
                f"{base}/v1/packages/{package['id']}/result?bridgeToken=test-token",
                data=result,
                method="POST",
            )
            with urllib.request.urlopen(result_request) as response:
                self.assertEqual(json.loads(response.read())["status"], "injected")
            stored = bridge.read_json(bridge.package_path(self.workspace, package["id"]))
            self.assertEqual(stored["status"], "injected")

            reapply_request = urllib.request.Request(
                f"{base}/v1/packages/{package['id']}/claim?bridgeToken=test-token",
                data=claim,
                method="POST",
            )
            with urllib.request.urlopen(reapply_request) as response:
                self.assertEqual(json.loads(response.read())['status'], 'claimed')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_http_lists_retained_versions_and_returns_package_without_target(self) -> None:
        first = self.create_package("v1")
        first.pop("_assetDigests")
        bridge.atomic_write_json(bridge.package_path(self.workspace, first["id"]), first)
        second = self.create_package("v2", "新版正文")
        server = bridge.BridgeServer(("127.0.0.1", 0), self.workspace, "test-instance", "test-token")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(f"{base}/v1/packages?bridgeToken=test-token") as response:
                listing = json.loads(response.read().decode("utf-8"))
            self.assertEqual({item["id"] for item in listing["packages"]}, {first["id"], second["id"]})
            self.assertEqual(listing["packages"][0]["articleId"], "weekly-news")

            with urllib.request.urlopen(f"{base}/v1/packages/{first['id']}?bridgeToken=test-token") as response:
                package = json.loads(response.read().decode("utf-8"))
            self.assertEqual(package["id"], first["id"])
            self.assertEqual(len(package["assetDigests"]["chart.png"]), 64)
            self.assertEqual(len(package["assetDigests"]["chart-detail.png"]), 64)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class BridgeProcessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name)
        self.processes: list[subprocess.Popen] = []
        self.ports: set[int] = set()

    def tearDown(self) -> None:
        for process in reversed(self.processes):
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)
        self.temporary.cleanup()

    def free_port(self) -> int:
        while True:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            if port >= 1024 and port not in self.ports:
                self.ports.add(port)
                return port

    def start_bridge(self, workspace: Path | None = None, idle_timeout: int = 30) -> subprocess.Popen:
        port = self.free_port()
        process = subprocess.Popen(
            [sys.executable, str(Path(bridge.__file__)), "serve", "--workspace", str(workspace or self.workspace),
             "--port-start", str(port), "--port-end", str(port), "--idle-timeout", str(idle_timeout)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.processes.append(process)
        return process

    def wait_ready(self, process: subprocess.Popen, workspace: Path | None = None) -> dict:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if process.poll() is not None:
                self.fail(f"Bridge exited before startup: {process.communicate()[1]}")
            state = bridge.read_state(workspace or self.workspace)
            if state and state.get("pid") == process.pid and bridge.healthy_state(state):
                return state
            time.sleep(0.03)
        self.fail("Bridge did not become ready")

    def assert_duplicate_rejected(self, process: subprocess.Popen) -> None:
        _, error = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 1, error)
        self.assertIn("already running", error)
        self.assertIn("ensure-bridge", error)
        self.assertNotIn("Traceback", error)

    def test_direct_serve_rejects_duplicate_and_preserves_owner_state(self) -> None:
        # Existing file contents must not change which byte is locked.
        bridge.state_dir(self.workspace).mkdir(parents=True)
        (bridge.state_dir(self.workspace) / "serve.lock").write_bytes(b"previous lock file")
        owner = self.start_bridge()
        state = self.wait_ready(owner)
        before = bridge.bridge_state_path(self.workspace).read_bytes()
        (self.workspace / "alias").mkdir()
        duplicate = self.start_bridge(self.workspace / "alias" / "..")
        self.assert_duplicate_rejected(duplicate)
        self.assertEqual(bridge.bridge_state_path(self.workspace).read_bytes(), before)
        self.assertTrue(bridge.healthy_state(state))

    def test_lifetime_lock_still_blocks_duplicate_without_discovery_file(self) -> None:
        owner = self.start_bridge()
        state = self.wait_ready(owner)
        bridge.bridge_state_path(self.workspace).unlink()
        self.assert_duplicate_rejected(self.start_bridge())
        self.assertFalse(bridge.bridge_state_path(self.workspace).exists())
        self.assertTrue(bridge.healthy_state(state))

    def test_concurrent_direct_serve_has_exactly_one_owner(self) -> None:
        candidates = [self.start_bridge() for _ in range(3)]
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if sum(process.poll() is not None for process in candidates) >= 2:
                break
            time.sleep(0.03)
        owners = [process for process in candidates if process.poll() is None]
        self.assertEqual(len(owners), 1)
        state = self.wait_ready(owners[0])
        self.assertEqual(state["pid"], owners[0].pid)
        for process in candidates:
            if process is not owners[0]:
                self.assert_duplicate_rejected(process)

    def test_forced_termination_releases_lock_and_stale_state_can_restart(self) -> None:
        owner = self.start_bridge()
        old_state = self.wait_ready(owner)
        owner.kill()
        owner.communicate(timeout=5)
        self.assertTrue(bridge.bridge_state_path(self.workspace).exists())
        self.assertTrue((bridge.state_dir(self.workspace) / "serve.lock").exists())
        replacement = self.start_bridge()
        new_state = self.wait_ready(replacement)
        self.assertNotEqual(new_state["instanceId"], old_state["instanceId"])
        self.assertEqual(new_state["pid"], replacement.pid)

    def test_idle_shutdown_cleans_state_and_allows_restart(self) -> None:
        owner = self.start_bridge(idle_timeout=1)
        self.wait_ready(owner)
        self.assertEqual(owner.wait(timeout=5), 0)
        self.assertFalse(bridge.bridge_state_path(self.workspace).exists())
        self.wait_ready(self.start_bridge())

    def test_failed_port_binding_releases_lifetime_lock(self) -> None:
        with socket.socket() as occupied:
            if os.name == "nt":
                occupied.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            occupied.bind(("127.0.0.1", 0))
            occupied.listen()
            port = occupied.getsockname()[1]
            with self.assertRaisesRegex(bridge.BridgeError, "No free bridge port"):
                bridge.serve(self.workspace, port, port, 1)
        self.assertFalse(bridge.bridge_state_path(self.workspace).exists())
        self.wait_ready(self.start_bridge())

    def test_different_workspaces_can_run_at_the_same_time(self) -> None:
        other = self.workspace / "other"
        first = self.wait_ready(self.start_bridge())
        second = self.wait_ready(self.start_bridge(other), other)
        self.assertNotEqual(first["instanceId"], second["instanceId"])
        self.assertTrue(bridge.healthy_state(first))
        self.assertTrue(bridge.healthy_state(second))

    def test_ensure_bridge_starts_and_reuses_guarded_server(self) -> None:
        port = self.free_port()
        spawn = subprocess.Popen

        def tracked_spawn(*args, **kwargs):
            process = spawn(*args, **kwargs)
            self.processes.append(process)
            return process

        # Retain the detached child handle in the test so it can be waited on
        # and cleaned up even when an assertion fails.
        with patch.object(bridge.subprocess, "Popen", side_effect=tracked_spawn):
            first = bridge.ensure_bridge(self.workspace, port, port, idle_timeout=1)
            second = bridge.ensure_bridge(self.workspace, port, port, idle_timeout=1)
        owner = self.processes[-1]
        self.assertEqual(second, first)
        self.assertEqual(first["pid"], owner.pid)
        self.assert_duplicate_rejected(self.start_bridge())
        self.assertEqual(owner.wait(timeout=5), 0)
        self.assertFalse(bridge.healthy_state(first))

    def test_healthy_legacy_server_without_lock_is_preserved(self) -> None:
        server = bridge.BridgeServer(("127.0.0.1", 0), self.workspace, "legacy-instance", "test-token")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        state = {"service": bridge.SERVICE_NAME, "port": server.server_port, "instanceId": "legacy-instance"}
        bridge.atomic_write_json(bridge.bridge_state_path(self.workspace), state)
        try:
            self.assert_duplicate_rejected(self.start_bridge())
            self.assertEqual(bridge.read_state(self.workspace), state)
            self.assertTrue(bridge.healthy_state(state))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
