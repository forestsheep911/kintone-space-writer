#!/usr/bin/env python3
"""Local bridge between article workspaces and the kintone userscript.

The bridge binds only to 127.0.0.1. It exposes Ready article packages to the
locally installed companion userscript, but never publishes a kintone comment
itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

SERVICE_NAME = "kintone-space-writer-bridge"
SCHEMA = "kintone-space-writer.bridge-package.v1"
ARTICLE_SCHEMA = "kintone-rich-article.v1"
DEFAULT_PORT_START = 8787
DEFAULT_PORT_END = 8807
DEFAULT_IDLE_TIMEOUT = 7200
CLAIM_SECONDS = 120
STATE_RELATIVE = Path("local-runs/kintone-space-writer")
PACKAGE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")


class BridgeError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_utc(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{secrets.token_hex(4)}.tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BridgeError(f"Could not read JSON file {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise BridgeError(f"JSON file must contain an object: {path}")
    return value


def workspace_path(value: Path) -> Path:
    return value.expanduser().resolve()


def state_dir(workspace: Path) -> Path:
    return workspace / STATE_RELATIVE


def packages_dir(workspace: Path) -> Path:
    return state_dir(workspace) / "packages"


def bridge_state_path(workspace: Path) -> Path:
    return state_dir(workspace) / "bridge.json"


def bridge_activity_path(workspace: Path) -> Path:
    return state_dir(workspace) / "bridge-activity.json"


def package_path(workspace: Path, package_id: str) -> Path:
    if not PACKAGE_ID_PATTERN.fullmatch(package_id):
        raise BridgeError("Invalid package ID")
    return packages_dir(workspace) / f"{package_id}.json"


def claim_expired(package: dict[str, Any]) -> bool:
    claim = package.get("claim")
    if not isinstance(claim, dict):
        return True
    expires = parse_utc(str(claim.get("expiresAt", "")))
    return expires is None or expires <= datetime.now(timezone.utc)


def refresh_expired_claim(path: Path, package: dict[str, Any]) -> dict[str, Any]:
    if package.get("status") == "claimed" and claim_expired(package):
        package["status"] = "ready"
        package["claim"] = None
        package["updatedAt"] = utc_now()
        atomic_write_json(path, package)
    return package


def ready_packages(workspace: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for path in sorted(packages_dir(workspace).glob("*.json")):
        try:
            package = refresh_expired_claim(path, read_json(path))
        except BridgeError:
            continue
        if package.get("schema") != SCHEMA or package.get("status") != "ready":
            continue
        results.append(package)
    return results


def retained_packages(workspace: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for path in packages_dir(workspace).glob("*.json"):
        try:
            package = refresh_expired_claim(path, read_json(path))
        except BridgeError:
            continue
        if package.get("schema") == SCHEMA:
            results.append(package)
    return sorted(results, key=lambda package: str(package.get("createdAt", "")), reverse=True)


def package_summary(package: dict[str, Any]) -> dict[str, Any]:
    article = package.get("article")
    return {
        "id": package.get("id"),
        "articleId": article.get("id") if isinstance(article, dict) else None,
        "title": article.get("title") if isinstance(article, dict) else None,
        "revisionNote": article.get("revisionNote") if isinstance(article, dict) else None,
        "version": package.get("version"),
        "hash": package.get("hash"),
        "status": package.get("status"),
        "createdAt": package.get("createdAt"),
        "updatedAt": package.get("updatedAt"),
    }


def package_asset_digests(package: dict[str, Any], workspace: Path) -> dict[str, str]:
    existing = package.get("_assetDigests")
    if isinstance(existing, dict) and all(isinstance(name, str) and isinstance(digest, str) for name, digest in existing.items()):
        return existing
    paths = package.get("_assetPaths")
    if not isinstance(paths, dict) or not all(isinstance(name, str) and isinstance(path, str) for name, path in paths.items()):
        return {}
    try:
        return asset_digests(paths, workspace)
    except OSError:
        return {}


def public_package(package: dict[str, Any], port: int, workspace: Path) -> dict[str, Any]:
    package_id = str(package["id"])
    assets = package.get("_assetPaths")
    asset_urls: dict[str, str] = {}
    if isinstance(assets, dict):
        for name in assets:
            encoded = urllib.parse.quote(str(name), safe="")
            asset_urls[str(name)] = f"http://127.0.0.1:{port}/v1/packages/{package_id}/assets/{encoded}"
    return {
        "schema": package.get("schema"),
        "id": package_id,
        "version": package.get("version"),
        "hash": package.get("hash"),
        "status": package.get("status"),
        "createdAt": package.get("createdAt"),
        "updatedAt": package.get("updatedAt"),
        "article": package.get("article"),
        "assetDigests": package_asset_digests(package, workspace),
        "assets": asset_urls,
    }


def safe_package_id(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")
    return (safe or "article")[:120]


def validate_article(article: dict[str, Any]) -> None:
    blocks = article.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        raise BridgeError("Article blocks must be a non-empty array")
    allowed = {"heading", "paragraph", "quote", "bulletList", "numberList", "divider", "image", "imageRow"}
    color_pattern = re.compile(r"^#[0-9A-Fa-f]{6}$")
    revision_note = article.get("revisionNote")
    if revision_note is not None and (not isinstance(revision_note, str) or not revision_note.strip() or len(revision_note) > 40):
        raise BridgeError("Article revisionNote must be a non-empty string of at most 40 characters")

    def validate_image(block: dict[str, Any], label: str) -> None:
        if not isinstance(block.get("fileName"), str) or not block["fileName"].strip():
            raise BridgeError(f"{label} must define fileName")
        width = block.get("width", 500)
        if isinstance(width, bool) or not isinstance(width, int) or not 100 <= width <= 750:
            raise BridgeError(f"{label} width must be from 100 to 750")

    def validate_text_style(value: dict[str, Any], label: str) -> None:
        if "fontSize" in value and (
            isinstance(value["fontSize"], bool)
            or not isinstance(value["fontSize"], int)
            or not 1 <= value["fontSize"] <= 7
        ):
            raise BridgeError(f"{label} fontSize must be from 1 to 7")
        for key in ("color", "backgroundColor"):
            if key in value and (
                not isinstance(value[key], str) or not color_pattern.fullmatch(value[key])
            ):
                raise BridgeError(f"{label} {key} must be a six-digit hex color")
        link = value.get("link")
        if link is not None:
            parsed = urllib.parse.urlsplit(str(link))
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise BridgeError(f"{label} link must be an HTTP(S) URL")

    for index, block in enumerate(blocks, start=1):
        if not isinstance(block, dict) or block.get("type") not in allowed:
            raise BridgeError(f"Article block {index} has an unsupported type")
        block_type = str(block["type"])
        if block_type in ("heading", "paragraph", "quote") and not isinstance(block.get("text"), str):
            raise BridgeError(f"Article block {index} must define text")
        if block_type in ("bulletList", "numberList"):
            items = block.get("items")
            if not isinstance(items, list) or not items or not all(isinstance(item, str) for item in items):
                raise BridgeError(f"Article list block {index} must define string items")
        if block_type == "heading" and block.get("level", 2) not in (1, 2, 3):
            raise BridgeError(f"Article heading block {index} level must be 1, 2, or 3")
        if block.get("align") not in (None, "left", "center", "right"):
            raise BridgeError(f"Article block {index} has an invalid alignment")
        validate_text_style(block, f"Article block {index}")
        if "runs" in block:
            runs = block["runs"]
            if block_type not in ("heading", "paragraph", "quote") or not isinstance(runs, list) or not runs:
                raise BridgeError(f"Article block {index} runs are only supported on non-empty text blocks")
            for run_index, run in enumerate(runs, start=1):
                if not isinstance(run, dict):
                    raise BridgeError(f"Article block {index} run {run_index} must be an object")
                mention = run.get("mention")
                if mention is None and not isinstance(run.get("text"), str):
                    raise BridgeError(f"Article block {index} run {run_index} must define text or mention")
                if mention is not None:
                    if (
                        not isinstance(mention, dict)
                        or not isinstance(mention.get("query"), str)
                        or not mention["query"].strip()
                        or len(mention["query"]) > 100
                        or mention.get("entityType") not in (None, "USER", "GROUP", "ORGANIZATION")
                    ):
                        raise BridgeError(
                            f"Article block {index} run {run_index} mention must define query and an optional valid entityType"
                        )
                validate_text_style(run, f"Article block {index} run {run_index}")
        if block_type == "image":
            validate_image(block, f"Image block {index}")
        if block_type == "imageRow":
            images = block.get("images")
            if not isinstance(images, list) or len(images) < 2 or not all(isinstance(image, dict) for image in images):
                raise BridgeError(f"Image row block {index} must define at least two images")
            if "gap" in block:
                raise BridgeError(f"Image row block {index} does not support gap; use per-image widths")
            for image_index, image in enumerate(images, start=1):
                validate_image(image, f"Image row block {index}, image {image_index}")


def article_asset_paths(
    workspace: Path,
    article: dict[str, Any],
    assets_root: Path,
) -> dict[str, str]:
    blocks = article["blocks"]
    result: dict[str, str] = {}
    for index, block in enumerate(blocks, start=1):
        images = [block] if block.get("type") == "image" else block.get("images", []) if block.get("type") == "imageRow" else []
        for image in images:
            file_name = str(image["fileName"])
            candidate = (assets_root / file_name).resolve()
            try:
                candidate.relative_to(assets_root.resolve())
                relative = candidate.relative_to(workspace)
            except ValueError as exc:
                raise BridgeError(f"Image must stay inside the selected assets root: {candidate}") from exc
            if not candidate.is_file():
                raise BridgeError(f"Article image was not found: {candidate}")
            result[file_name] = relative.as_posix()
    return result


def content_hash(article: dict[str, Any], assets: dict[str, str], workspace: Path) -> str:
    digest = hashlib.sha256(json.dumps(article, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    for name, relative in sorted(assets.items()):
        digest.update(name.encode("utf-8"))
        with (workspace / relative).open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def asset_digests(assets: dict[str, str], workspace: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for name, relative in assets.items():
        digest = hashlib.sha256()
        with (workspace / relative).open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        result[name] = digest.hexdigest()
    return result


def create_ready_package(
    workspace: Path,
    article_path: Path,
    assets_root: Path,
) -> dict[str, Any]:
    # Keep all paths in their canonical form.  On macOS, tempfile commonly
    # returns /var/... while Path.resolve() produces /private/var/...; mixing
    # the two makes otherwise valid assets fail the containment check below.
    workspace = workspace_path(workspace)
    article_path = article_path.expanduser().resolve()
    assets_root = assets_root.expanduser().resolve()
    article = read_json(article_path)
    if article.get("schema") != ARTICLE_SCHEMA:
        raise BridgeError(f"Article schema must be {ARTICLE_SCHEMA}")
    validate_article(article)
    assets = article_asset_paths(workspace, article, assets_root)
    digest = content_hash(article, assets, workspace)
    article_id = safe_package_id(str(article.get("id") or article_path.stem))
    version = str(article.get("version") or datetime.now().strftime("%Y%m%d-%H%M%S"))
    package_id = safe_package_id(f"{article_id}-{version}-{digest[:10]}")
    now = utc_now()
    existing_path = package_path(workspace, package_id)
    if existing_path.exists():
        existing = read_json(existing_path)
        if existing.get("hash") == digest and existing.get("schema") == SCHEMA:
            return existing

    package = {
        "schema": SCHEMA,
        "id": package_id,
        "version": version,
        "hash": digest,
        "status": "ready",
        "createdAt": now,
        "updatedAt": now,
        "article": article,
        "_articlePath": article_path.relative_to(workspace).as_posix(),
        "_assetPaths": assets,
        "_assetDigests": asset_digests(assets, workspace),
        "claim": None,
        "events": [{"at": now, "type": "ready"}],
    }
    atomic_write_json(package_path(workspace, package_id), package)
    return package


def health_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/health"


def healthy_state(state: dict[str, Any]) -> bool:
    try:
        port = int(state["port"])
        with urllib.request.urlopen(health_url(port), timeout=0.4) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload.get("service") == SERVICE_NAME and payload.get("instanceId") == state.get("instanceId")
    except (KeyError, ValueError, OSError, urllib.error.URLError, json.JSONDecodeError):
        return False


def read_state(workspace: Path) -> dict[str, Any] | None:
    path = bridge_state_path(workspace)
    if not path.exists():
        return None
    try:
        return read_json(path)
    except BridgeError:
        return None


def spawn_server(workspace: Path, port_start: int, port_end: int, idle_timeout: int) -> None:
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "serve",
        "--workspace",
        str(workspace),
        "--port-start",
        str(port_start),
        "--port-end",
        str(port_end),
        "--idle-timeout",
        str(idle_timeout),
    ]
    kwargs: dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "cwd": str(workspace),
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(command, **kwargs)


def ensure_bridge(
    workspace: Path,
    port_start: int = DEFAULT_PORT_START,
    port_end: int = DEFAULT_PORT_END,
    idle_timeout: int = DEFAULT_IDLE_TIMEOUT,
) -> dict[str, Any]:
    directory = state_dir(workspace)
    directory.mkdir(parents=True, exist_ok=True)
    lock_path = directory / "start.lock"
    lock_fd: int | None = None
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        state = read_state(workspace)
        if state and healthy_state(state):
            return state
        try:
            lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(lock_fd, f"{os.getpid()} {time.time()}".encode("ascii"))
            break
        except FileExistsError:
            try:
                if time.time() - lock_path.stat().st_mtime > 15:
                    lock_path.unlink(missing_ok=True)
            except OSError:
                pass
            time.sleep(0.15)
    if lock_fd is None:
        raise BridgeError("Timed out waiting for the bridge startup lock")
    try:
        state = read_state(workspace)
        if state and healthy_state(state):
            return state
        spawn_server(workspace, port_start, port_end, idle_timeout)
        for _ in range(60):
            time.sleep(0.1)
            state = read_state(workspace)
            if state and healthy_state(state):
                return state
        raise BridgeError("Bridge process did not become healthy")
    finally:
        os.close(lock_fd)
        lock_path.unlink(missing_ok=True)


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], workspace: Path, instance_id: str, token: str):
        super().__init__(address, BridgeHandler)
        self.workspace = workspace_path(workspace)
        self.instance_id = instance_id
        self.token = token
        self.last_activity = time.monotonic()
        self.activity_lock = threading.Lock()
        self.activity: dict[str, Any] = {"counts": {}, "lastByRoute": {}}

    def record_activity(self, route: str, detail: dict[str, Any] | None = None) -> None:
        now = utc_now()
        with self.activity_lock:
            counts = self.activity.setdefault("counts", {})
            counts[route] = int(counts.get(route, 0)) + 1
            event = {"at": now, "route": route, **(detail or {})}
            self.activity["last"] = event
            self.activity.setdefault("lastByRoute", {})[route] = event
            atomic_write_json(bridge_activity_path(self.workspace), self.activity)


class BridgeHandler(BaseHTTPRequestHandler):
    server: BridgeServer

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def send_json(self, status: int, value: Any) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        token = self.headers.get("X-KSW-Bridge-Token", "")
        if not token:
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            token = query.get("bridgeToken", [""])[0]
        return secrets.compare_digest(token, self.server.token)

    def require_authorized(self) -> bool:
        if self.authorized():
            self.server.last_activity = time.monotonic()
            return True
        self.server.record_activity(
            "unauthorized",
            {"path": urllib.parse.urlsplit(self.path).path},
        )
        self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
        return False

    def read_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise BridgeError("Invalid Content-Length") from exc
        if length < 0 or length > 1024 * 1024:
            raise BridgeError("Request body is too large")
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BridgeError("Request body must be valid JSON") from exc
        if not isinstance(value, dict):
            raise BridgeError("Request body must be an object")
        return value

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/health":
            self.send_json(
                HTTPStatus.OK,
                {
                    "service": SERVICE_NAME,
                    "version": 1,
                    "instanceId": self.server.instance_id,
                    "port": self.server.server_port,
                    "token": self.server.token,
                },
            )
            return
        if not self.require_authorized():
            return
        if parsed.path == "/v1/ready":
            matches = ready_packages(self.server.workspace)
            if not matches:
                self.send_response(HTTPStatus.NO_CONTENT)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if len(matches) > 1:
                self.send_json(
                    HTTPStatus.CONFLICT,
                    {"error": "multiple-ready-packages", "count": len(matches)},
                )
                return
            self.send_json(HTTPStatus.OK, public_package(matches[0], self.server.server_port, self.server.workspace))
            return
        if parsed.path == "/v1/packages":
            packages = retained_packages(self.server.workspace)
            self.send_json(HTTPStatus.OK, {"packages": [package_summary(package) for package in packages]})
            return
        package_match = re.fullmatch(r"/v1/packages/([^/]+)", parsed.path)
        if package_match:
            try:
                package_id = urllib.parse.unquote(package_match.group(1))
                package = refresh_expired_claim(
                    package_path(self.server.workspace, package_id),
                    read_json(package_path(self.server.workspace, package_id)),
                )
                self.send_json(HTTPStatus.OK, public_package(package, self.server.server_port, self.server.workspace))
            except BridgeError:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "package-not-found"})
            return
        asset_match = re.fullmatch(r"/v1/packages/([^/]+)/assets/([^/]+)", parsed.path)
        if asset_match:
            package_id = urllib.parse.unquote(asset_match.group(1))
            asset_name = urllib.parse.unquote(asset_match.group(2))
            self.server.record_activity("asset", {"packageId": package_id, "asset": asset_name})
            try:
                package = read_json(package_path(self.server.workspace, package_id))
                relative = package.get("_assetPaths", {}).get(asset_name)
                if not isinstance(relative, str):
                    raise BridgeError("Unknown asset")
                asset_path = (self.server.workspace / relative).resolve()
                asset_path.relative_to(self.server.workspace)
                if not asset_path.is_file():
                    raise BridgeError("Asset not found")
                content = asset_path.read_bytes()
            except (BridgeError, ValueError, OSError):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "asset-not-found"})
                return
            mime = "application/octet-stream"
            suffix = asset_path.suffix.lower()
            if suffix == ".png":
                mime = "image/png"
            elif suffix in (".jpg", ".jpeg"):
                mime = "image/jpeg"
            elif suffix == ".gif":
                mime = "image/gif"
            elif suffix == ".webp":
                mime = "image/webp"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not-found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        if not self.require_authorized():
            return
        match = re.fullmatch(r"/v1/packages/([^/]+)/(claim|result)", parsed.path)
        if not match:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not-found"})
            return
        try:
            package_id = urllib.parse.unquote(match.group(1))
            action = match.group(2)
            self.server.record_activity(action, {"packageId": package_id})
            body = self.read_body()
            path = package_path(self.server.workspace, package_id)
            package = refresh_expired_claim(path, read_json(path))
            if body.get("hash") != package.get("hash"):
                raise BridgeError("Package hash mismatch")
            if action == "claim":
                client_id = str(body.get("clientId", ""))
                if not client_id:
                    raise BridgeError("clientId is required")
                if package.get("status") not in ("ready", "claimed", "injected", "failed"):
                    raise BridgeError(f"Package status is {package.get('status')}")
                existing_claim = package.get("claim")
                if (
                    package.get("status") == "claimed"
                    and isinstance(existing_claim, dict)
                    and existing_claim.get("clientId") != client_id
                    and not claim_expired(package)
                ):
                    self.send_json(HTTPStatus.CONFLICT, {"error": "package-already-claimed"})
                    return
                now = datetime.now(timezone.utc).replace(microsecond=0)
                package["status"] = "claimed"
                package["claim"] = {
                    "clientId": client_id,
                    "claimedAt": now.isoformat(),
                    "expiresAt": (now + timedelta(seconds=CLAIM_SECONDS)).isoformat(),
                }
                package["updatedAt"] = now.isoformat()
                package.setdefault("events", []).append({"at": now.isoformat(), "type": "claimed"})
                atomic_write_json(path, package)
                self.send_json(HTTPStatus.OK, {"status": "claimed"})
                return
            result_status = str(body.get("status", ""))
            if result_status not in ("injected", "failed"):
                raise BridgeError("Result status must be injected or failed")
            now = utc_now()
            package["status"] = result_status
            package["claim"] = None
            package["updatedAt"] = now
            if result_status == "injected":
                package["injectedAt"] = now
                package["injectedPage"] = str(body.get("pageUrl", ""))
                package.pop("lastError", None)
            else:
                package["lastError"] = str(body.get("error", ""))[:1000]
            package.setdefault("events", []).append(
                {"at": now, "type": result_status, "note": str(body.get("error", ""))[:500] or None}
            )
            atomic_write_json(path, package)
            self.send_json(HTTPStatus.OK, {"status": result_status})
        except (BridgeError, OSError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})


def serve(workspace: Path, port_start: int, port_end: int, idle_timeout: int) -> int:
    if port_start < 1024 or port_end < port_start or port_end > 65535:
        raise BridgeError("Invalid bridge port range")
    instance_id = secrets.token_hex(12)
    token = secrets.token_urlsafe(32)
    server: BridgeServer | None = None
    for port in range(port_start, port_end + 1):
        try:
            server = BridgeServer(("127.0.0.1", port), workspace, instance_id, token)
            break
        except OSError:
            continue
    if server is None:
        raise BridgeError(f"No free bridge port in range {port_start}-{port_end}")
    state = {
        "service": SERVICE_NAME,
        "instanceId": instance_id,
        "pid": os.getpid(),
        "port": server.server_port,
        "startedAt": utc_now(),
        "workspace": str(workspace),
    }
    atomic_write_json(bridge_state_path(workspace), state)
    server.timeout = 1
    try:
        while time.monotonic() - server.last_activity < idle_timeout:
            server.handle_request()
    finally:
        server.server_close()
        current = read_state(workspace)
        if current and current.get("instanceId") == instance_id:
            bridge_state_path(workspace).unlink(missing_ok=True)
    return 0


def command_ensure(args: argparse.Namespace) -> int:
    state = ensure_bridge(workspace_path(args.workspace), args.port_start, args.port_end, args.idle_timeout)
    print(
        json.dumps(
            {
                "service": state.get("service"),
                "status": "running",
                "port": state.get("port"),
                "pid": state.get("pid"),
                "workspace": state.get("workspace"),
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def command_mark_ready(args: argparse.Namespace) -> int:
    workspace = workspace_path(args.workspace)
    article_path = (workspace / args.article).resolve() if not args.article.is_absolute() else args.article.resolve()
    assets_root = (workspace / args.assets_root).resolve() if not args.assets_root.is_absolute() else args.assets_root.resolve()
    for candidate, label in ((article_path, "article"), (assets_root, "assets root")):
        try:
            candidate.relative_to(workspace)
        except ValueError as exc:
            raise BridgeError(f"{label} path must stay inside the workspace: {candidate}") from exc
    if not article_path.is_file():
        raise BridgeError(f"Article JSON was not found: {article_path}")
    if not assets_root.is_dir():
        raise BridgeError(f"Assets directory was not found: {assets_root}")
    package = create_ready_package(workspace, article_path, assets_root)
    state = ensure_bridge(workspace, args.port_start, args.port_end, args.idle_timeout)
    print(
        json.dumps(
            {
                "id": package["id"],
                "status": package["status"],
                "hash": package["hash"],
                "bridgePort": state.get("port"),
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def command_list(args: argparse.Namespace) -> int:
    workspace = workspace_path(args.workspace)
    values = []
    for path in sorted(packages_dir(workspace).glob("*.json")):
        try:
            package = refresh_expired_claim(path, read_json(path))
        except BridgeError:
            continue
        values.append(
            {
                "id": package.get("id"),
                "status": package.get("status"),
                "updatedAt": package.get("updatedAt"),
            }
        )
    print(json.dumps(values, indent=2, ensure_ascii=False))
    return 0


def command_retry(args: argparse.Namespace) -> int:
    workspace = workspace_path(args.workspace)
    path = package_path(workspace, args.package_id)
    package = read_json(path)
    now = utc_now()
    package["status"] = "ready"
    package["claim"] = None
    package["updatedAt"] = now
    package.pop("lastError", None)
    package.pop("injectedAt", None)
    package.pop("injectedPage", None)
    package.setdefault("events", []).append({"at": now, "type": "ready-retry"})
    atomic_write_json(path, package)
    ensure_bridge(workspace, args.port_start, args.port_end, args.idle_timeout)
    print(json.dumps({"id": args.package_id, "status": "ready"}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_bridge_options(command: argparse.ArgumentParser) -> None:
        command.add_argument("--workspace", type=Path, default=Path("."))
        command.add_argument("--port-start", type=int, default=DEFAULT_PORT_START)
        command.add_argument("--port-end", type=int, default=DEFAULT_PORT_END)
        command.add_argument("--idle-timeout", type=int, default=DEFAULT_IDLE_TIMEOUT)

    ensure = subparsers.add_parser("ensure-bridge", help="Start or reuse the local bridge")
    add_bridge_options(ensure)
    ensure.set_defaults(func=command_ensure)

    serve_command = subparsers.add_parser("serve", help=argparse.SUPPRESS)
    add_bridge_options(serve_command)
    serve_command.set_defaults(
        func=lambda args: serve(
            workspace_path(args.workspace), args.port_start, args.port_end, args.idle_timeout
        )
    )

    ready = subparsers.add_parser("mark-ready", help="Validate an article and expose it to the userscript")
    add_bridge_options(ready)
    ready.add_argument("--article", type=Path, required=True)
    ready.add_argument("--assets-root", type=Path, default=Path("assets"))
    ready.set_defaults(func=command_mark_ready)

    list_command = subparsers.add_parser("list", help="List local bridge package states")
    list_command.add_argument("--workspace", type=Path, default=Path("."))
    list_command.set_defaults(func=command_list)

    retry = subparsers.add_parser("retry", help="Return an injected or failed package to Ready")
    add_bridge_options(retry)
    retry.add_argument("--package-id", required=True)
    retry.set_defaults(func=command_retry)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except (BridgeError, FileNotFoundError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
