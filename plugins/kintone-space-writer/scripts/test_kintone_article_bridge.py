from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import kintone_article_bridge as bridge  # noqa: E402


class BridgeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name)
        (self.workspace / "assets").mkdir()
        (self.workspace / "assets" / "chart.png").write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        (self.workspace / "kintone-targets.yaml").write_text(
            """\
defaultTarget: news
environments:
  customer:
    baseUrl: https://customer.cybozu.cn
    origins:
      - https://customer.cybozu.cn
      - https://customer.s.cybozu.cn
    username: writer@example.com
    passwordEnv: KINTONE_PASSWORD
    spaces:
      main:
        spaceId: '10'
        threads:
          news:
            alias: news
            threadId: '12'
""",
            encoding="utf-8",
        )

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
                        {"type": "image", "fileName": "chart.png", "caption": "图 1"},
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
            self.workspace / "kintone-targets.yaml",
            "news",
        )

    def test_target_requires_exact_origin_space_and_thread(self) -> None:
        package = self.create_package("v1")
        self.assertTrue(bridge.target_matches(package, "https://customer.s.cybozu.cn", "10", "12"))
        self.assertFalse(bridge.target_matches(package, "https://customer.cybozu.cn", "10", "99"))
        self.assertFalse(bridge.target_matches(package, "https://other.cybozu.cn", "10", "12"))

    def test_mark_ready_is_idempotent_and_new_version_supersedes_old_ready(self) -> None:
        first = self.create_package("v1")
        duplicate = self.create_package("v1")
        self.assertEqual(first["id"], duplicate["id"])
        self.assertEqual(len(list(bridge.packages_dir(self.workspace).glob("*.json"))), 1)

        second = self.create_package("v2", "新版正文")
        stored_first = bridge.read_json(bridge.package_path(self.workspace, first["id"]))
        self.assertEqual(stored_first["status"], "superseded")
        self.assertEqual(second["status"], "ready")

    def test_http_ready_claim_asset_and_result_flow(self) -> None:
        package = self.create_package("v1")
        server = bridge.BridgeServer(("127.0.0.1", 0), self.workspace, "test-instance", "test-token")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"

        try:
            query = urllib.parse.urlencode(
                {
                    "origin": "https://customer.s.cybozu.cn",
                    "spaceId": "10",
                    "threadId": "12",
                    "bridgeToken": "test-token",
                }
            )
            request = urllib.request.Request(f"{base}/v1/ready?{query}")
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
                    "origin": "https://customer.s.cybozu.cn",
                    "spaceId": "10",
                    "threadId": "12",
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
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
