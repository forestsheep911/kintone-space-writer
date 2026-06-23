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

try:
    import yaml
except ImportError:  # pragma: no cover - depends on local Python environment
    yaml = None


MAX_COMMENT_FILES = 5
DEFAULT_IMAGE_WIDTH = 600
REQUIRED_CONFIG_KEYS = (
    "KINTONE_BASE_URL",
    "KINTONE_USERNAME",
    "KINTONE_PASSWORD",
    "KINTONE_SPACE_ID",
    "KINTONE_THREAD_ID",
)
ENV_EXAMPLE_NAME = ".env.example"
TARGETS_EXAMPLE_NAME = "kintone-targets.example.yaml"
DEFAULT_TARGETS_PATH = Path("kintone-targets.yaml")
TARGET_REQUIRED_FIELDS = ("baseUrl", "username", "spaceId", "threadId")


class ConfigError(RuntimeError):
    pass


def plugin_root() -> Path:
    return Path(__file__).resolve().parents[1]


def env_example_path() -> Path:
    return plugin_root() / ENV_EXAMPLE_NAME


def default_env_target() -> Path:
    return Path(".env")


def targets_example_path() -> Path:
    return plugin_root() / TARGETS_EXAMPLE_NAME


def shell_copy_command(source: Path, target: Path) -> str:
    return f"Copy-Item -LiteralPath '{source}' -Destination '{target}'"


def script_command() -> str:
    return f"python {Path(sys.argv[0])}"


def env_setup_help(env_path: Path, *, missing_keys: list[str] | None = None) -> str:
    example = env_example_path()
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
            "For multiple kintone domains, Spaces, or threads, create target aliases:",
            f"   {script_command()} init-targets",
        ]
    )
    return "\n".join(lines)


def targets_setup_help(targets_path: Path) -> str:
    return "\n".join(
        [
            f"Cannot use kintone target aliases from: {targets_path}",
            "",
            "How to fix:",
            "1. Create the workspace target file:",
            f"   {shell_copy_command(targets_example_path(), targets_path)}",
            "2. Fill environments, spaces, and threads. Give each thread a unique alias.",
            "3. Put real passwords in .env or system environment variables, then reference them with passwordEnv.",
            "4. Run preflight for one alias:",
            f"   {script_command()} --target test-news preflight",
        ]
    )


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
        if not values.get(key):
            values[key] = value
    return values


def load_targets(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ConfigError(targets_setup_help(path))
    if yaml is None:
        raise ConfigError(
            "\n".join(
                [
                    "Reading kintone-targets.yaml requires PyYAML.",
                    "Install it for this Python environment:",
                    "   python -m pip install pyyaml",
                    "",
                    "You can still use the old single-target .env mode without YAML.",
                ]
            )
        )
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        raise ConfigError(f"Could not read YAML target file {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"Target file must contain a YAML mapping: {path}")
    has_nested = isinstance(data.get("environments"), dict)
    has_flat = isinstance(data.get("targets"), dict)
    if not has_nested and not has_flat:
        raise ConfigError(
            f"Target file must define environments or a legacy targets mapping: {path}"
        )
    return data


def string_value(source: dict[str, Any], key: str) -> str:
    value = source.get(key, "")
    if value is None:
        return ""
    return str(value).strip()


def secret_value(
    target: dict[str, Any],
    env: dict[str, str],
    *,
    value_key: str,
    env_key: str,
    label: str,
    required: bool,
    target_alias: str,
) -> str:
    direct = string_value(target, value_key)
    env_name = string_value(target, env_key)
    if direct:
        return direct
    if env_name:
        value = env.get(env_name, "").strip()
        if not value:
            raise ConfigError(
                "\n".join(
                    [
                        f"Target '{target_alias}' points {label} to {env_name}, but that variable is empty.",
                        "Set it in .env or in the system environment, then run preflight again.",
                    ]
                )
            )
        return value
    if required:
        raise ConfigError(
            f"Target '{target_alias}' must set {value_key} or {env_key} for {label}."
        )
    return ""


def merge_dicts(*sources: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for source in sources:
        for key, value in source.items():
            if key not in ("spaces", "threads") and value not in (None, ""):
                merged[key] = value
    return merged


def collect_nested_targets(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    environments = data.get("environments")
    if not isinstance(environments, dict) or not environments:
        raise ConfigError("Target file must define a non-empty environments mapping")
    targets: dict[str, dict[str, Any]] = {}
    for env_key, env_config in environments.items():
        if not isinstance(env_config, dict):
            raise ConfigError(f"Environment '{env_key}' must be a mapping")
        spaces = env_config.get("spaces")
        if not isinstance(spaces, dict) or not spaces:
            raise ConfigError(f"Environment '{env_key}' must define spaces")
        for space_key, space_config in spaces.items():
            if not isinstance(space_config, dict):
                raise ConfigError(f"Space '{env_key}.{space_key}' must be a mapping")
            threads = space_config.get("threads")
            if not isinstance(threads, dict) or not threads:
                raise ConfigError(f"Space '{env_key}.{space_key}' must define threads")
            for thread_key, thread_config in threads.items():
                if not isinstance(thread_config, dict):
                    raise ConfigError(
                        f"Thread '{env_key}.{space_key}.{thread_key}' must be a mapping"
                    )
                alias = string_value(thread_config, "alias")
                if not alias:
                    raise ConfigError(
                        f"Thread '{env_key}.{space_key}.{thread_key}' must define a unique alias"
                    )
                if alias in targets:
                    raise ConfigError(f"Duplicate thread alias in target file: {alias}")
                target = merge_dicts(env_config, space_config, thread_config)
                target["environment"] = str(env_key)
                target["space"] = str(space_key)
                target["thread"] = str(thread_key)
                target["label"] = " / ".join(
                    part
                    for part in (
                        string_value(env_config, "label"),
                        string_value(space_config, "label"),
                        string_value(thread_config, "nickname")
                        or string_value(thread_config, "label"),
                    )
                    if part
                )
                targets[alias] = target
    return targets


def collect_targets(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if isinstance(data.get("environments"), dict):
        return collect_nested_targets(data)
    raw_targets = data.get("targets")
    if not isinstance(raw_targets, dict) or not raw_targets:
        raise ConfigError("Target file must define a non-empty targets mapping")
    targets: dict[str, dict[str, Any]] = {}
    for alias, target in raw_targets.items():
        if not isinstance(target, dict):
            raise ConfigError(f"Target '{alias}' must be a mapping")
        targets[str(alias)] = target
    return targets


def build_target_config(
    env_path: Path,
    targets_path: Path,
    requested_target: str | None,
) -> dict[str, str]:
    env = load_env(env_path)
    data = load_targets(targets_path)
    targets = collect_targets(data)
    target_alias = (
        requested_target
        or env.get("KINTONE_TARGET", "").strip()
        or string_value(data, "defaultTarget")
    )
    if not target_alias:
        raise ConfigError(
            "\n".join(
                [
                    "No kintone target alias was selected.",
                    f"Set defaultTarget in {targets_path}, set KINTONE_TARGET in .env, or pass --target <alias>.",
                    f"Available targets: {', '.join(sorted(targets))}",
                ]
            )
        )
    raw_target = targets.get(target_alias)
    if not isinstance(raw_target, dict):
        raise ConfigError(
            "\n".join(
                [
                    f"Unknown kintone target alias: {target_alias}",
                    f"Available targets: {', '.join(sorted(targets))}",
                ]
            )
        )
    missing = [field for field in TARGET_REQUIRED_FIELDS if not string_value(raw_target, field)]
    if missing:
        raise ConfigError(
            f"Target '{target_alias}' is missing required fields: {', '.join(missing)}"
        )
    password = secret_value(
        raw_target,
        env,
        value_key="password",
        env_key="passwordEnv",
        label="password",
        required=True,
        target_alias=target_alias,
    )
    basic_auth_username = secret_value(
        raw_target,
        env,
        value_key="basicAuthUsername",
        env_key="basicAuthUsernameEnv",
        label="cybozu Basic Auth username",
        required=False,
        target_alias=target_alias,
    )
    basic_auth_password = secret_value(
        raw_target,
        env,
        value_key="basicAuthPassword",
        env_key="basicAuthPasswordEnv",
        label="cybozu Basic Auth password",
        required=False,
        target_alias=target_alias,
    )
    config = {
        "target": target_alias,
        "target_label": string_value(raw_target, "label"),
        "base_url": string_value(raw_target, "baseUrl").rstrip("/"),
        "username": string_value(raw_target, "username"),
        "password": password,
        "space_id": string_value(raw_target, "spaceId"),
        "thread_id": string_value(raw_target, "threadId"),
        "guest_space_id": string_value(raw_target, "guestSpaceId"),
        "image_width": string_value(raw_target, "imageWidth") or str(DEFAULT_IMAGE_WIDTH),
        "basic_auth_username": basic_auth_username,
        "basic_auth_password": basic_auth_password,
    }
    has_basic_user = bool(config["basic_auth_username"])
    has_basic_password = bool(config["basic_auth_password"])
    if has_basic_user != has_basic_password:
        raise ConfigError(
            f"Target '{target_alias}' must set Basic Auth username and password together"
        )
    return config


def require_config(env: dict[str, str], key: str, env_path: Path) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise ConfigError(env_setup_help(env_path, missing_keys=[key]))
    return value


def build_env_config(env_path: Path) -> dict[str, str]:
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


def build_config(
    env_path: Path,
    targets_path: Path,
    requested_target: str | None,
) -> dict[str, str]:
    if requested_target or targets_path.exists():
        return build_target_config(env_path, targets_path, requested_target)
    return build_env_config(env_path)


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
            "target": config.get("target") or None,
            "targetLabel": config.get("target_label") or None,
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
    config = build_config(args.env, args.targets, args.target)
    width = parse_width(config["image_width"])
    summary = {
        "target": config.get("target") or None,
        "targetLabel": config.get("target_label") or None,
        "baseUrl": config["base_url"],
        "spaceId": config["space_id"],
        "threadId": config["thread_id"],
        "imageWidth": width,
        "auth": "username-password",
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


def command_init_env(args: argparse.Namespace) -> int:
    target = args.output or default_env_target()
    source = env_example_path()
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
                "1. If you use kintone-targets.yaml, fill the password variables referenced by passwordEnv.",
                "2. If you use legacy single-target .env mode, fill:",
                *[f"   - {key}" for key in REQUIRED_CONFIG_KEYS],
                "3. Run preflight before posting. For target aliases:",
                f"   {script_command()} --target test-news preflight",
                "   For legacy single-target .env mode:",
                f"   {script_command()} --env {target} preflight",
            ]
        )
    )
    return 0


def command_init_targets(args: argparse.Namespace) -> int:
    target = args.output or DEFAULT_TARGETS_PATH
    source = targets_example_path()
    if not source.exists():
        raise ConfigError(f"Bundled target example was not found: {source}")
    if target.exists() and not args.force:
        raise ConfigError(
            "\n".join(
                [
                    f"Target file already exists: {target}",
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
                f"Created target template: {target}",
                f"Source example: {source}",
                "",
                "Next steps:",
                "1. Edit environments, spaces, and threads. Give each thread a unique alias.",
                "2. Put real passwords in .env using the passwordEnv names from the YAML file.",
                "3. Run preflight for one target:",
                f"   {script_command()} --target test-news preflight",
            ]
        )
    )
    return 0


def command_upload_file(args: argparse.Namespace) -> int:
    config = build_config(args.env, args.targets, args.target)
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
    config = build_config(args.env, args.targets, args.target)
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
        help="Path to workspace .env secrets file. Defaults to .env.",
    )
    parser.add_argument(
        "--targets",
        type=Path,
        default=DEFAULT_TARGETS_PATH,
        help="Path to kintone target alias YAML. Defaults to kintone-targets.yaml.",
    )
    parser.add_argument(
        "--target",
        help="Target alias from kintone-targets.yaml. Overrides defaultTarget and KINTONE_TARGET.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_env = subparsers.add_parser(
        "init-env",
        help="Create a workspace env template from the bundled example",
    )
    init_env.add_argument(
        "--output",
        type=Path,
        help="Output env path. Defaults to .env.",
    )
    init_env.add_argument(
        "--force",
        action="store_true",
        help="Replace the output file if it already exists.",
    )
    init_env.set_defaults(func=command_init_env)

    init_targets = subparsers.add_parser(
        "init-targets",
        help="Create a workspace kintone target alias YAML template",
    )
    init_targets.add_argument(
        "--output",
        type=Path,
        help="Output YAML path. Defaults to kintone-targets.yaml.",
    )
    init_targets.add_argument(
        "--force",
        action="store_true",
        help="Replace the output file if it already exists.",
    )
    init_targets.set_defaults(func=command_init_targets)

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
