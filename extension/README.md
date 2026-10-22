# kintone Space Writer Chrome 扩展

扩展版本：0.4.0。支持 Chrome 120 及以上版本，以及相应的 Chromium 版 Edge。

## 安装

1. 解压 `kintone-space-writer-extension-v0.4.0.zip` 到固定目录。
2. 打开 `chrome://extensions`（Edge 使用 `edge://extensions`），启用开发者模式。
3. 选择“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。
4. 停用旧 Tampermonkey Space Writer 脚本，再刷新已登录的 kintone 页面。
5. 在已有 Space 话题页打开“发表评论…”，从 Space Writer 小窗选择版本并点击“写入”。检查结果后，手动点击 kintone 的发布按钮。

Codex 写作插件仍负责启动本地 Bridge、准备文章和配图。扩展不需要 Vite 开发服务器，不需要 Tampermonkey，不会自动发布文章。Bridge 离线时，请先在文章工作区通过插件准备文章。

## 迁移旧设置

文章、图片、历史版本和 Bridge 包保存在原文章工作区，不需要搬迁。
旧浏览器中的归档状态和小窗位置可以按以下步骤迁移：

1. 保留原浏览器配置，在 Tampermonkey 中打开并安装 ZIP 内 `migration/export-settings.user.js`。它与旧版使用同一个名称和 namespace，替换旧脚本并保留该脚本的存储；只增加一个设置导出按钮。
2. 刷新 kintone 页面，点击“导出旧版设置”，保存 JSON 文件。
3. 停用这个导出脚本。点击扩展工具栏按钮，进入设置页，选择“导入设置 JSON”。
4. 刷新 kintone 页面，确认归档状态与小窗位置。

设置文件只包含文章归档标记和小窗位置，不包含 Bridge 令牌或登录凭据。导入会合并设置，同名条目以导入值为准。也可以在扩展设置页导出当前设置作为备份。

## 更新与回退

更新时保留已安装扩展和固定解压目录，以新版文件替换该目录，再到浏览器扩展管理页点击“重新加载”，然后刷新 kintone 页面。不要卸载后重装，卸载会清除扩展本地存储。

每个版本的 `manifest.json` 使用同一个公钥维持扩展 ID；公钥用于固定身份，不能验证 ZIP 来源。ZIP 方式需要手动更新，不会沿用 Tampermonkey 的更新地址。

回退时停用扩展，安装 `migration/rollback-tampermonkey.user.js` 并启用旧脚本。旧脚本的原有设置仍由 Tampermonkey 保管；扩展中新修改的设置不会自动反向同步。

## 开发与验证

```powershell
cd extension
pnpm install
pnpm check
pnpm package
```

构建目录为仓库根目录下的 `dist/kintone-space-writer-extension/`，ZIP 和 SHA-256 记录也在 `dist/`。`identity.json` 只保存固定公钥和预期 ID。

后台只接受扩展自身顶层 kintone 页面发来的固定 Bridge 操作，限定 `127.0.0.1:8787–8807`，拒绝跳转和任意 URL 转发。页面令牌通过固定的主环境函数取得，图片上传与编辑器操作仍在当前已登录页面完成。

扩展消息中的单张图片上限为 16 MiB，单次 Bridge JSON 响应上限为 4 MiB。超过时会在小窗报告错误，请压缩图片或减少单篇内容。

浏览器回归使用本地 Bridge 与模拟 kintone 页面。真实租户的证书、权限、内部上传接口和原生编辑器清理行为需要单独验收。
