#!/bin/sh
# No Python or globally installed uv required. Call with: sh /path/to/run.sh doctor
set -eu
tool=${1:-doctor}
if [ "$#" -gt 0 ]; then shift; fi
case "$tool" in doctor|bridge|rest) ;; *) echo 'Expected doctor, bridge, or rest.' >&2; exit 1;; esac
plugin_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
case "$(uname -s)" in
  Darwin) os=macos; default_root="$HOME/Library/Application Support/kintone-space-writer";;
  Linux) os=linux; default_root="${XDG_DATA_HOME:-$HOME/.local/share}/kintone-space-writer";;
  *) echo 'Unsupported platform. On Windows use run.ps1.' >&2; exit 1;;
esac
case "$(uname -m)" in x86_64|amd64) arch=x86_64;; arm64|aarch64) arch=aarch64;; *) echo 'Unsupported CPU architecture.' >&2; exit 1;; esac
target="$os-$arch"
uv_version= python_version= url= archive_sha= member= exe_sha=
while IFS='=' read -r key value; do
  case "$key" in
    UV_VERSION) uv_version=$value;; PYTHON_VERSION) python_version=$value;; URL) url=$value;;
    ARCHIVE_SHA256) archive_sha=$value;; MEMBER) member=$value;; EXE_SHA256) exe_sha=$value;;
  esac
done < "$plugin_root/runtime/$target.conf"
[ -n "$uv_version" ] && [ -n "$python_version" ] && [ -n "$url" ] && [ -n "$archive_sha" ] && [ -n "$member" ] && [ -n "$exe_sha" ] || { echo 'Incomplete pinned runtime configuration.' >&2; exit 1; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f1; else shasum -a 256 "$1" | cut -d ' ' -f1; fi; }
runtime_root=${KSW_RUNTIME_HOME:-$default_root}
mkdir -p "$runtime_root"
runtime_root=$(CDPATH= cd -- "$runtime_root" && pwd -P)
uv_dir="$runtime_root/uv/$uv_version/$target"
mkdir -p "$uv_dir"
uv="$uv_dir/uv"
bundled="$plugin_root/runtime/bin/$target/uv"
temporary=
cleanup() { if [ -n "$temporary" ]; then rm -f "$temporary/archive" "$temporary/uv"; rmdir "$temporary"; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -f "$bundled" ]; then
  [ "$(sha256 "$bundled")" = "$exe_sha" ] || { echo 'Bundled uv checksum mismatch.' >&2; exit 1; }
  uv=$bundled
elif [ ! -f "$uv" ] || [ "$(sha256 "$uv")" != "$exe_sha" ]; then
  temporary=$(mktemp -d "$uv_dir/prepare.XXXXXX")
  echo 'Preparing Space Writer runtime: downloading pinned uv...' >&2
  curl --proto '=https' --proto-redir '=https' --fail --location --silent --show-error --retry 2 --max-time 180 "$url" -o "$temporary/archive"
  [ "$(sha256 "$temporary/archive")" = "$archive_sha" ] || { echo 'Downloaded uv archive checksum mismatch.' >&2; exit 1; }
  tar -xOf "$temporary/archive" "$member" > "$temporary/uv"
  [ "$(sha256 "$temporary/uv")" = "$exe_sha" ] || { echo 'Extracted uv checksum mismatch.' >&2; exit 1; }
  chmod 755 "$temporary/uv"
  mv -f "$temporary/uv" "$uv"
  cleanup; temporary=
fi
# Obtain the version without requiring a JSON parser before Python exists.
version=$(sed -n 's/^version = "\([^"]*\)"$/\1/p' "$plugin_root/pyproject.toml")
[ -n "$version" ] || { echo 'Missing runtime project version.' >&2; exit 1; }
lock_hash=$(sha256 "$plugin_root/uv.lock" | cut -c1-12)
environment="$runtime_root/environments/$version-$lock_hash-$target"
export KSW_RUNTIME_HOME="$runtime_root" UV_PROJECT_ENVIRONMENT="$environment"
export UV_PYTHON_INSTALL_DIR="$runtime_root/python" UV_CACHE_DIR="$runtime_root/cache"
export UV_PYTHON_INSTALL_BIN=0 UV_PYTHON_NO_REGISTRY=1
if [ "${KSW_PYTHON_SOURCE:-}" = managed ]; then UV_PYTHON_PREFERENCE=only-managed; else UV_PYTHON_PREFERENCE=system; fi
export UV_PYTHON_PREFERENCE PYTHONUTF8=1 PYTHONIOENCODING=utf-8 PYTHONDONTWRITEBYTECODE=1
export PYTHONNOUSERSITE=1
unset PYTHONHOME PYTHONPATH VIRTUAL_ENV
"$uv" --no-config --no-progress --color never sync --project "$plugin_root" --locked --no-dev --python "$python_version"
exec "$environment/bin/python" "$plugin_root/scripts/runtime_entry.py" "$tool" "$@"
