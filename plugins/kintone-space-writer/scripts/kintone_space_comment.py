#!/usr/bin/env python3
"""Post article-style comments to kintone Space threads.

This helper intentionally supports only the v0.1 route:
upload optional files, then add a comment to an existing Space thread.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MAX_COMMENT_FILES = 5
DEFAULT_IMAGE_WIDTH = 600
REQUIRED_CONFIG_KEYS = (
    "KINTONE_BASE_URL",
    "KINTONE_USERNAME",
    "KINTONE_PASSWORD",
    "KINTONE_SPACE_ID",
    "KINTONE_THREAD_ID",
)
ENV_EXAMPLE_BY_MODE = {
    "single": ".env.example",
    "test": ".env.test.example",
    "prod": ".env.prod.example",
}


class ConfigError(RuntimeError):
    pass


def plugin_root() -> Path:
    return Path(__file__).resolve().parents[1]


def env_example_path(mode: str = "single") -> Path:
    return plugin_root() / ENV_EXAMPLE_BY_MODE[mode]


def default_env_target(mode: str = "single") -> Path:
    if mode == "test":
        return Path(".env.test")
    if mode == "prod":
        return Path(".env.prod")
    return Path(".env")


def shell_copy_command(source: Path, target: Path) -> str:
    return f"Copy-Item -LiteralPath '{source}' -Destination '{target}'"


def script_command() -> str:
    return f"python {Path(sys.argv[0])}"


def env_setup_help(env_path: Path, *, missing_keys: list[str] | None = None) -> str:
    example = env_example_path("single")
    file_action = (
        "Update this env file"
        if env_path.exists()
        else "Create a workspace env file from the bundled example"
    )
    lines = [
        f"Cannot use kintone publishing settings from: {env_path}",
        "",
        "How to fix:",
        f"1. {file_action}:",
    ]
    if env_path.exists():
        lines.append(f"   {env_path}")
    else:
        lines.append(f"   {shell_copy_command(example, env_path)}")
    lines.append("2. Fill in these required values:")
    for key in REQUIRED_CONFIG_KEYS:
        marker = " (missing)" if missing_keys and key in missing_keys else ""
        lines.append(f"   - {key}{marker}")
    lines.extend(
        [
            "3. Run preflight again before posting:",
            f"   {script_command()} --env {env_path} preflight",
            "",
            "For separate test and production destinations, create .env.test and .env.prod from:",
            f"   {env_example_path('test')}",
            f"   {env_example_path('prod')}",
        ]
    )
    return "\n".join(lines)


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


def require_config(env: dict[str, str], key: str, env_path: Path) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise ConfigError(env_setup_help(env_path, missing_keys=[key]))
    return value


def build_config(env_path: Path) -> dict[str, str]:
    if not env_path.exists():
        raise ConfigError(env_setup_help(env_path))
    env = load_env(env_path)
    missing_keys = [key for key in REQUIRED_CONFIG_KEYS if not env.get(key, "").strip()]
    if missing_keys:
        raise ConfigError(env_setup_help(env_path, missing_keys=missing_keys))
    config = {
        "base_url": require_config(env, "KINTONE_BASE_URL", env_path).rstrip("/"),
        "username": require_config(env, "KINTONE_USERNAME", env_path),
        "password": require_config(env, "KINTONE_PASSWORD", env_path),
        "space_id": require_config(env, "KINTONE_SPACE_ID", env_path),
        "thread_id": require_config(env, "KINTONE_THREAD_ID", env_path),
        "guest_space_id": env.get("KINTONE_GUEST_SPACE_ID", "").strip(),
        "image_width": env.get("KINTONE_IMAGE_WIDTH", str(DEFAULT_IMAGE_WIDTH)).strip(),
        "basic_auth_username": env.get("KINTONE_BASIC_AUTH_USERNAME", "").strip(),
        "basic_auth_password": env.get("KINTONE_BASIC_AUTH_PASSWORD", "").strip(),
    }
    has_basic_user = bool(config["basic_auth_username"])
    has_basic_password = bool(config["basic_auth_password"])
    if has_basic_user != has_basic_password:
        raise ConfigError(
            "KINTONE_BASIC_AUTH_USERNAME and KINTONE_BASIC_AUTH_PASSWORD must be set together"
        )
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
    headers = {"X-Cybozu-Authorization": token}
    if config.get("basic_auth_username"):
        basic_token = base64.b64encode(
            (
                f"{config['basic_auth_username']}:"
                f"{config['basic_auth_password']}"
            ).encode("utf-8")
        ).decode("ascii")
        headers["Authorization"] = f"Basic {basic_token}"
    return headers


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


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def thread_url(config: dict[str, str]) -> str:
    if config.get("guest_space_id"):
        return (
            f"{config['base_url']}/k/guest/{urllib.parse.quote(config['guest_space_id'])}"
            f"/#/space/{urllib.parse.quote(config['space_id'])}"
            f"/thread/{urllib.parse.quote(config['thread_id'])}"
        )
    return (
        f"{config['base_url']}/k/#/space/{urllib.parse.quote(config['space_id'])}"
        f"/thread/{urllib.parse.quote(config['thread_id'])}"
    )


def write_publish_record(
    archive_dir: Path,
    *,
    config: dict[str, str],
    result: dict[str, Any],
    payload: dict[str, Any],
    draft_id: str,
    title: str,
    text: str,
    draft_file: Path | None,
    attached_files: list[dict[str, str]],
) -> Path:
    archive_dir.mkdir(parents=True, exist_ok=True)
    comment_id = str(result.get("id", "unknown"))
    timestamp = utc_now()
    safe_timestamp = timestamp.replace(":", "").replace("+", "Z")
    safe_draft_id = "".join(
        char if char.isalnum() or char in ("-", "_") else "-" for char in draft_id
    ).strip("-") or "draft"
    record_path = archive_dir / f"{safe_timestamp}-{safe_draft_id}-comment-{comment_id}.json"
    record = {
        "schema": "kintone-space-writer.publish-record.v1",
        "status": "active",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "draft": {
            "id": draft_id,
            "title": title,
            "file": str(draft_file) if draft_file else None,
            "textSha256": text_sha256(text),
            "textLength": len(text),
        },
        "kintone": {
            "baseUrl": config["base_url"],
            "spaceId": config["space_id"],
            "threadId": config["thread_id"],
            "guestSpaceId": config["guest_space_id"] or None,
            "threadUrl": thread_url(config),
            "commentId": comment_id,
        },
        "attachments": attached_files,
        "payload": payload,
        "result": result,
        "events": [
            {
                "at": timestamp,
                "type": "posted",
                "note": "Created by kintone-space-writer.",
            }
        ],
    }
    record_path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return record_path


def mark_record(record_path: Path, status: str, note: str) -> None:
    payload = json.loads(record_path.read_text(encoding="utf-8"))
    now = utc_now()
    payload["status"] = status
    payload["updatedAt"] = now
    events = payload.setdefault("events", [])
    events.append({"at": now, "type": "status-changed", "status": status, "note": note})
    record_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


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
        "cybozuBasicAuth": bool(config["basic_auth_username"]),
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


def command_init_env(args: argparse.Namespace) -> int:
    target = args.output or default_env_target(args.mode)
    source = env_example_path(args.mode)
    if not source.exists():
        raise ConfigError(f"Bundled env example was not found: {source}")
    if target.exists() and not args.force:
        raise ConfigError(
            "\n".join(
                [
                    f"Env file already exists: {target}",
                    "No changes were made.",
                    "Edit the existing file, or rerun with --force if you intentionally want to replace it.",
                ]
            )
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    print(
        "\n".join(
            [
                f"Created env template: {target}",
                f"Source example: {source}",
                "",
                "Next steps:",
                "1. Open the env file and fill in:",
                *[f"   - {key}" for key in REQUIRED_CONFIG_KEYS],
                "2. Leave KINTONE_GUEST_SPACE_ID empty for a normal Space.",
                "3. Run preflight before posting:",
                f"   {script_command()} --env {target} preflight",
            ]
        )
    )
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
    attached_files = [
        {"source": "existing-file-key", "path": "", "fileKey": key} for key in file_keys
    ]
    if args.dry_run:
        file_keys.extend(f"DRY_RUN_FILE_KEY:{path.name}" for path in images)
    else:
        for image_path in images:
            file_key = upload_file(config, image_path)
            file_keys.append(file_key)
            attached_files.append(
                {"source": "upload", "path": str(image_path), "fileKey": file_key}
            )

    payload = build_comment_payload(config, text, file_keys, width)
    if args.dry_run:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    result = request_json(config, "POST", "space/thread/comment.json", payload)
    output: dict[str, Any] = {"result": result}
    if args.archive_dir:
        record_path = write_publish_record(
            args.archive_dir,
            config=config,
            result=result,
            payload=payload,
            draft_id=args.draft_id,
            title=args.title,
            text=text,
            draft_file=args.text_file,
            attached_files=attached_files,
        )
        output["publishRecord"] = str(record_path)
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


def command_mark_record(args: argparse.Namespace) -> int:
    mark_record(args.record, args.status, args.note or "")
    print(json.dumps({"record": str(args.record), "status": args.status}, indent=2))
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

    init_env = subparsers.add_parser(
        "init-env",
        help="Create a workspace env template from the bundled example",
    )
    init_env.add_argument(
        "--mode",
        choices=["single", "test", "prod"],
        default="single",
        help="Which example to copy. Defaults to single.",
    )
    init_env.add_argument(
        "--output",
        type=Path,
        help="Output env path. Defaults to .env, .env.test, or .env.prod.",
    )
    init_env.add_argument(
        "--force",
        action="store_true",
        help="Replace the output file if it already exists.",
    )
    init_env.set_defaults(func=command_init_env)

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
    post.add_argument("--archive-dir", type=Path, help="Directory for publish record JSON files")
    post.add_argument("--draft-id", default="draft", help="Stable local draft/version ID")
    post.add_argument("--title", default="", help="Human-readable article title")
    post.add_argument("--dry-run", action="store_true", help="Print payload without API mutations")
    post.set_defaults(func=command_post_comment)

    mark = subparsers.add_parser("mark-record", help="Mark a local publish record status")
    mark.add_argument("--record", type=Path, required=True)
    mark.add_argument(
        "--status",
        required=True,
        choices=["active", "deleted-manual", "superseded", "failed", "void"],
    )
    mark.add_argument("--note", help="Reason or operator note")
    mark.set_defaults(func=command_mark_record)

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
