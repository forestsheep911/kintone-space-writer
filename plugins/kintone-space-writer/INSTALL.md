# Space Writer 插件 0.3.0

用户需要 Codex 插件和浏览器扩展两项。这个 ZIP 交付插件目录，使用 Codex 支持的插件安装渠道加载；不是浏览器扩展 ZIP，也不假定 Codex 支持直接拖入 ZIP 安装。

## 首次使用

安装插件后让 Codex 准备文章到 Space Writer 预览即可。技能会调用统一启动器：Windows 使用 `scripts/run.ps1`，macOS/Linux 使用 `scripts/run.sh`。启动器会复用兼容的 Python；找不到指定版本时，通过 uv 下载 Python，并在用户目录建立专用虚拟环境、按 `uv.lock` 安装依赖。不会往全局 Python 装包，也不修改全局 PATH。

Windows 交付包带有对应平台的 uv；源码或其他平台缺少 uv 时，会从固定的官方发布地址下载并校验 SHA-256。首次使用需要访问 GitHub 的 uv/Python 发布文件及 PyPI。完整离线首次安装未包含在本版本中。后续运行复用本地环境；仍需可访问 kintone 才能写入或发布。

Windows x64 是当前实测交付平台。Windows ARM64、macOS 与 Linux 的下载清单和入口已提供，尚需在对应平台验收；Linux 清单针对 glibc 系统。
macOS/Linux 入口使用系统的 `sh`、`curl`、`tar`，以及 `sha256sum` 或 `shasum`。

手动检查（将 `<plugin>` 换成安装目录的绝对路径）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" doctor
```

```sh
sh "<plugin>/scripts/run.sh" doctor
```

`doctor` 输出实际 Python、虚拟环境和 PyYAML 版本，不输出凭据。Windows 的 `-ExecutionPolicy Bypass` 仅作用于这次启动进程，不更改系统策略；组织策略仍可能限制脚本执行。

## 文件位置与更新

- Windows：`%LOCALAPPDATA%/kintone-space-writer/`。
- macOS：`~/Library/Application Support/kintone-space-writer/`。
- Linux：`${XDG_DATA_HOME:-~/.local/share}/kintone-space-writer/`。

其中 `python/` 保存受管理解释器，`environments/` 按插件版本、锁文件摘要与平台隔离，`cache/` 保存下载缓存。插件安装目录和文章目录不需要写入依赖。可用 `KSW_RUNTIME_HOME` 指定专用运行目录；`KSW_PYTHON_SOURCE=managed` 可强制使用插件管理的 Python。

文章、配图和 Bridge 队列仍留在文章工作区。更新插件不会迁移或删除它们。已运行的 Bridge 会继续用原解释器及代码，停止旧进程后再用新版启动器启动即可应用更新；启动器不会强制终止正在处理文章的服务。

启动失败会返回非零退出码并显示具体错误。不要通过全局 `pip install` 绕过错误，也不要回退到其他工作区的 `.venv`。

## 手动运行工具

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" bridge mark-ready --workspace . --article drafts/article-v001.rich.json --assets-root assets
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" bridge list --workspace .
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<plugin>/scripts/run.ps1" rest init-targets
```

macOS/Linux 将前缀换成 `sh "<plugin>/scripts/run.sh"`，后续参数相同。Bridge 仍为本机按需服务，同一工作区有单实例保护，最终发布由用户在 kintone 中完成。

uv 固定版本与各平台的归档、程序摘要在 `runtime/uv-manifest.json` 中；许可原文保留在 `runtime/licenses/`。不运行网络安装脚本，不自动注册开机任务。
