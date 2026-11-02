<div align="center">

<img src="resources/readme-logo.png" alt="ModMind Mobile" width="720" />

# ModMind Mobile

在 Android 手机上使用 AI 工作台、灵感台和本地 Minecraft 创作环境。

**[下载 APK](https://github.com/waterpail114514/modmind-mobile/releases/tag/1.0.0-preview.1)** · **[官网](https://ether-studio.top/)** · **[开发与验证说明](README.mobile.zh-CN.md)**

</div>

当前预览版 **1.0.0-preview.1**，Android versionCode **9**。支持 **Android 10 / API 29 及以上、ARM64**。这是具有本地 Node、JDK、Codex 运行环境的独立应用，不依赖电脑或 Termux 运行项目。

## 可以做什么

- 工作台与灵感台：模型对话、历史记录、停止任务、项目知识与 MCP 工具。
- 模组制作：Fabric 1.21.1 基础模板、文件编辑、手机本地构建和 JAR 导出。
- 整合包制作：项目管理、导入 JAR、配置编辑与标准 mrpack 导出。
- 对话内图片生成、静态 3D 预览、原生文件分享，以及账号、模型和外观设置。

本版未迁移桌面全部插件、加载器与游戏测试能力。首次构建所需的 Gradle/Maven 依赖需要联网。完整范围和设备实测边界见 [Android 说明](android-mobile/README.md) 与 [兼容记录](android-mobile/ANDROID-COMPATIBILITY.zh-CN.md)。

## 安装与开发

从 Release 下载 `ModMind-Mobile-1.0.0-preview.1-arm64.apk`，可使用同页 SHA-256 文件校验。应用标识为 `dev.modmind`；预览版沿用已有测试证书以支持覆盖安装，发布包关闭 Android 和 WebView 调试，未采用应用商店发布签名。

源码入口是 `android-mobile/`。新环境在仓库根目录与 `android-mobile/` 分别运行 `npm ci`；随后按 [原生运行环境构建说明](android-mobile/README.md) 准备构建输入。签名密钥、私有数据和运行时缓存不随源码公开。

```powershell
node android-mobile/scripts/typecheck.mjs
node android-mobile/scripts/test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File android-mobile/scripts/build-apk.ps1
```

## 版本与仓库

| 版本线 | 仓库 | 下载 |
| --- | --- | --- |
| 桌面 2.0 预览版 | [modmind](https://github.com/waterpail114514/modmind) | [2.0.0-preview.1](https://github.com/waterpail114514/modmind/releases/tag/2.0.0-preview.1) |
| 桌面 1.4 维护版 | [modmind-1.4](https://github.com/waterpail114514/modmind-1.4) | [最新维护版](https://github.com/waterpail114514/modmind-1.4/releases/latest) |
| Android 独立版 | [modmind-mobile](https://github.com/waterpail114514/modmind-mobile) | [1.0.0-preview.1](https://github.com/waterpail114514/modmind-mobile/releases/tag/1.0.0-preview.1) |

三个仓库保留各自开发历史。Android 独立版源码位于 `android-mobile/`，与桌面仓库中的 `android-twa/` 网页壳不同。

## 开源协议

项目原创源码采用 [AGPL-3.0-only](LICENSE)，第三方组件按各自许可证分发，见 [第三方声明](THIRD_PARTY_NOTICES.md)。开源许可不包含模型服务额度。
