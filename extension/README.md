# kintone Space Writer Chrome 扩展

扩展版本：0.4.2。支持 Chrome 120 及以上版本，以及相应的 Chromium 版 Edge。

## 安装

1. 下载 `kintone-space-writer-extension-v0.4.2.zip`。
2. 打开 `chrome://extensions`，启用开发者模式。
3. 将 ZIP 文件直接拖到扩展管理页，浏览器负责解压并加载，无需手动解压。
4. 停用旧 Tampermonkey Space Writer 脚本，再刷新已登录的 kintone 页面。
5. 在已有 Space 话题页打开“发表评论…”，从 Space Writer 小窗选择版本并点击“写入”。检查结果后，手动点击 kintone 的发布按钮。

Codex 写作插件仍负责启动本地 Bridge、准备文章和配图。扩展不需要 Vite 开发服务器，不需要 Tampermonkey，不会自动发布文章。Bridge 离线时，请先在文章工作区通过插件准备文章。

“手动解压到固定目录 → 加载已解压的扩展程序”也是可用的备用方式，适合源码调试。Edge 可在 `edge://extensions` 使用这个备用入口；ZIP 拖拽行为以其实际版本为准。

## 小窗使用

展开后的标题栏有六点拖动手柄，按住手柄或名称区域即可移动。点击右上角“—”收起后，小窗变成保留名称的浮条；浮条左侧标有“按住这里拖动”，右侧“展开”按钮单独操作。位置和收起状态会保存，靠近窗口边缘展开时会将面板移回可见范围。

“文章”列表默认展开上次选择的文章（首次打开时选择最新文章），每篇先显示最新版本；点击“查看其余 N 个版本”可展开历史版本。版本时间标为“创建于”，不会随写入而改变。“图片无需重传”仅表示当前编辑器可复用已上传图片。

成功写入后，底部显示最近写入的版本、文章和图片数；修改编辑器内容后会提示“编辑器已修改”。这条提示仅对应本次页面会话，刷新或切换话题后清除，不能作为已发布记录。

## 迁移旧设置

文章、图片、历史版本和 Bridge 包保存在原文章工作区，不需要搬迁。
旧浏览器中的归档状态和小窗位置可以按以下步骤迁移：

1. 保留原浏览器配置，在 Tampermonkey 中打开并安装 ZIP 内 `migration/export-settings.user.js`。它与旧版使用同一个名称和 namespace，替换旧脚本并保留该脚本的存储；只增加一个设置导出按钮。
2. 刷新 kintone 页面，点击“导出旧版设置”，保存 JSON 文件。
3. 停用这个导出脚本。点击扩展工具栏按钮，进入设置页，选择“导入设置 JSON”。
4. 刷新 kintone 页面，确认归档状态与小窗位置。

设置文件只包含文章归档标记和小窗位置，不包含 Bridge 令牌或登录凭据。导入会合并设置，同名条目以导入值为准。也可以在扩展设置页导出当前设置作为备份。

## 更新与回退

通过 ZIP 拖拽安装时，后续将新版 ZIP 再拖入扩展管理页；保持公钥不变，让浏览器识别为同一扩展。更新后确认版本号已变化、只保留一份扩展且归档设置仍在，再刷新 kintone 页面。

通过手动解压目录安装时，也可替换固定目录中的文件，再点击扩展卡片的“重新加载”。不要卸载后重装，卸载会清除扩展本地存储。

每个版本的 `manifest.json` 使用同一个公钥维持扩展 ID；公钥用于固定身份，不能验证 ZIP 来源。ZIP 方式需要手动更新，不会沿用 Tampermonkey 的更新地址。

ZIP 拖拽入口及自动解压流程已核对 [Chromium 前端源码](https://github.com/chromium/chromium/blob/main/chrome/browser/resources/extensions/drag_and_drop_handler.ts)和[安装处理源码](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/developer_private/developer_private_functions.cc)。现有自动回归验证的是加载目录、身份与设置保留；系统文件拖拽及目标 Canary 的升级交互仍属于单独验收项。

回退时停用扩展，安装 `migration/rollback-tampermonkey.user.js` 并启用旧脚本。旧脚本的原有设置仍由 Tampermonkey 保管；扩展中新修改的设置不会自动反向同步。

## 开发与验证

```powershell
cd extension
pnpm install
pnpm check
pnpm package
```

构建目录为仓库根目录下的 `dist/kintone-space-writer-extension/`，ZIP 和 SHA-256 记录也在 `dist/`。`identity.json` 只保存固定公钥和预期 ID。

日常开发只需将这个固定目录加载一次。之后每次构建完成，在原扩展卡片点击“重新加载”，再刷新 kintone 页面即可。

后台只接受扩展自身顶层 kintone 页面发来的固定 Bridge 操作，限定 `127.0.0.1:8787–8807`，拒绝跳转和任意 URL 转发。页面令牌通过固定的主环境函数取得，图片上传与编辑器操作仍在当前已登录页面完成。

扩展消息中的单张图片上限为 16 MiB，单次 Bridge JSON 响应上限为 4 MiB。超过时会在小窗报告错误，请压缩图片或减少单篇内容。

浏览器回归使用本地 Bridge 与模拟 kintone 页面。真实租户的证书、权限、内部上传接口和原生编辑器清理行为需要单独验收。
