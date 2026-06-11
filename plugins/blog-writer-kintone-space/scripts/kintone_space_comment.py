#!/usr/bin/env python3
"""Post article-style comments to kintone Space threads.

This helper intentionally supports only the v0.1 route:
upload optional files, then add a comment to an existing Space thread.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


MAX_COMMENT_FILES = 5
DEFAULT_IMAGE_WIDTH = 600


class ConfigError(RuntimeError):
    pass


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    for key, value in os.environ.items():
        values.setdefault(key, value)
    return values


def require_config(env: dict[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise ConfigError(f"Missing required setting: {key}")
    return value


def build_config(env_path: Path) -> dict[str, str]:
    env = load_env(env_path)
    config = {
        "base_url": require_config(env, "KINTONE_BASE_URL").rstrip("/"),
        "username": require_config(env, "KINTONE_USERNAME"),
        "password": require_config(env, "KINTONE_PASSWORD"),
        "space_id": require_config(env, "KINTONE_SPACE_ID"),
        "thread_id": require_config(env, "KINTONE_THREAD_ID"),
        "guest_space_id": env.get("KINTONE_GUEST_SPACE_ID", "").strip(),
        "image_width": env.get("KINTONE_IMAGE_WIDTH", str(DEFAULT_IMAGE_WIDTH)).strip(),
    }
    return config


def api_path(config: dict[str, str], path: str) -> str:
    guest_space_id = config.get("guest_space_id", "")
    if guest_space_id:
        return f"/k/guest/{urllib.parse.quote(guest_space_id)}/v1/{path.lstrip('/')}"
    return f"/k/v1/{path.lstrip('/')}"


def auth_headers(config: dict[str, str]) -> dict[str, str]:
    token = base64.b64encode(
        f"{config['username']}:{config['password']}".encode("utf-8")
    ).decode("ascii")
    return {"X-Cybozu-Authorization": token}


def request_json(
    config: dict[str, str],
    method: str,
    path: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    url = config["base_url"] + api_path(config, path)
    body = json.dumps(payload).encode("utf-8")
    headers = {
        **auth_headers(config),
        "Content-Type": "application/json",
    }
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"kintone API error {exc.code}: {error_body}") from exc


def multipart_body(file_path: Path) -> tuple[bytes, str]:
    boundary = "----codex-kintone-" + secrets.token_hex(12)
    filename = file_path.name
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    file_bytes = file_path.read_bytes()
    parts = [
        f"--{boundary}\r\n".encode("utf-8"),
        (
            'Content-Disposition: form-data; name="file"; '
            f'filename="{filename}"\r\n'
        ).encode("utf-8"),
        f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
        file_bytes,
        b"\r\n",
        f"--{boundary}--\r\n".encode("utf-8"),
    ]
    return b"".join(parts), boundary


def upload_file(config: dict[str, str], file_path: Path) -> str:
    if not file_path.exists():
        raise FileNotFoundError(file_path)
    url = config["base_url"] + api_path(config, "file.json")
    body, boundary = multipart_body(file_path)
    headers = {
        **auth_headers(config),
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
            file_key = payload.get("fileKey")
            if not isinstance(file_key, str) or not file_key:
                raise RuntimeError(f"Upload response did not contain fileKey: {payload}")
            return file_key
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"kintone upload error {exc.code}: {error_body}") from exc


def parse_width(value: str) -> int:
    try:
        width = int(value)
    except ValueError as exc:
        raise ConfigError("KINTONE_IMAGE_WIDTH must be an integer") from exc
    if width < 100 or width > 750:
        raise ConfigError("KINTONE_IMAGE_WIDTH must be between 100 and 750")
    return width


def build_comment_payload(
    config: dict[str, str],
    text: str,
    file_keys: list[str],
    width: int,
) -> dict[str, Any]:
    comment: dict[str, Any] = {}
    if text:
        comment["text"] = text
    if file_keys:
        comment["files"] = [{"fileKey": key, "width": width} for key in file_keys]
    if not comment:
        raise ConfigError("Comment requires text or at least one file")
    return {
        "space": config["space_id"],
        "thread": config["thread_id"],
        "comment": comment,
    }


def command_preflight(args: argparse.Namespace) -> int:
    config = build_config(args.env)
    width = parse_width(config["image_width"])
    summary = {
        "baseUrl": config["base_url"],
        "spaceId": config["space_id"],
        "threadId": config["thread_id"],
        "guestSpaceId": config["guest_space_id"] or None,
        "imageWidth": width,
        "auth": "username-password",
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


def command_upload_file(args: argparse.Namespace) -> int:
    config = build_config(args.env)
    file_key = upload_file(config, args.file)
    print(json.dumps({"fileKey": file_key}, indent=2))
    return 0


def read_comment_text(args: argparse.Namespace) -> str:
    if args.text_file:
        return args.text_file.read_text(encoding="utf-8").strip()
    if args.text:
        return args.text.strip()
    return ""


def command_post_comment(args: argparse.Namespace) -> int:
    config = build_config(args.env)
    width = parse_width(args.width or config["image_width"])
    images = args.image or []
    if len(images) + len(args.file_key or []) > MAX_COMMENT_FILES:
        raise ConfigError(f"Space comments support at most {MAX_COMMENT_FILES} files")

    text = read_comment_text(args)
    file_keys = list(args.file_key or [])
    if args.dry_run:
        file_keys.extend(f"DRY_RUN_FILE_KEY:{path.name}" for path in images)
    else:
        for image_path in images:
            file_keys.append(upload_file(config, image_path))

    payload = build_comment_payload(config, text, file_keys, width)
    if args.dry_run:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    result = request_json(config, "POST", "space/thread/comment.json", payload)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env",
        type=Path,
        default=Path(".env"),
        help="Path to workspace .env file. Defaults to .env.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    preflight = subparsers.add_parser("preflight", help="Validate local settings")
    preflight.set_defaults(func=command_preflight)

    upload = subparsers.add_parser("upload-file", help="Upload one file and print fileKey")
    upload.add_argument("--file", type=Path, required=True)
    upload.set_defaults(func=command_upload_file)

    post = subparsers.add_parser("post-comment", help="Upload files and post a comment")
    post.add_argument("--text", help="Comment text")
    post.add_argument("--text-file", type=Path, help="UTF-8 text file for comment body")
    post.add_argument("--image", type=Path, action="append", help="Image/file to upload and attach")
    post.add_argument("--file-key", action="append", help="Existing uploaded fileKey to attach")
    post.add_argument("--width", help="Image display width, 100 to 750")
    post.add_argument("--dry-run", action="store_true", help="Print payload without API mutations")
    post.set_defaults(func=command_post_comment)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except (ConfigError, FileNotFoundError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
