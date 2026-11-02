# P1 旧安卓启动修复

2026-11-02，用户反馈启动后只显示 `No static method of ... java.nio.file.Path`，无法进入工作台。

## 原因与修复

原生安装器 `BundledRuntime.prepare()` 在创建 `/system/bin/sh` 链接时调用 `Path.of()`。该方法在 Android API 34 才提供，但应用安装门槛为 API 29，Android 10–13 因而会在启动阶段触发 `NoSuchMethodError`。这段代码运行于系统 ART；APK 内用于项目构建的 JDK 21 不会替换 Android 应用自身的 Java 核心库。

替换为已有依赖 `new File(destination).toPath()`，API 26 起可用。路径约束、符号链接行为与项目数据位置保持原样，没有增加依赖或提高最低系统版本。

依据：[Android Path.of](https://developer.android.com/reference/java/nio/file/Path#of(java.lang.String,%20java.lang.String...))、[File.toPath](https://developer.android.com/reference/java/io/File#toPath())。

## 防止再次漏检

先在原 P1 源码上运行完整 `lintRelease`，确实得到唯一错误：`NewApi: Call requires API level 34 ... current min is 29`，位置与用户截图一致。原先发布构建自动运行的 `lintVitalRelease` 没有阻止该错误，因此此前文档中的“release lint 已通过”不能当作完整 API 兼容验证。

`build-apk.ps1` 现在对待打包的每个变体运行完整 `lintDebug` / `lintRelease`，出现错误即中止；`NewApi` / `InlinedApi` 显式设为 fatal，完整 XML / HTML 报告随构建保留。不添加基线或抑制项。

## 版本与验证边界

按用户要求仍发布 **1.0.0-preview.1**，内部 versionCode 从 8 增至 9，安装 ID 和原签名继续使用。用户可以覆盖安装；不应先卸载应用，否则会删除本地项目、账号和历史。

本轮结果：

- 原 P1 完整 release lint：1 个错误、7 个警告，唯一错误为本次 `Path.of` / `NewApi`；修复后 debug 和 release 完整 lint 均为 0 个错误、7 个既有警告，`NewApi` / `InlinedApi` 均为 0。警告不作已修复声明。
- 两种 APK 均核对 36 项资源、86 个原生库；发布 APK 的 dex 经 Android SDK apkanalyzer 检查，已使用 `File.toPath`，没有 `Path.of` 调用。移动源码类型诊断 0、既有外部类型诊断 3。
- 发布 APK：272035939 bytes，SHA-256 `761d9fe713753f17837dfa3ac3ffa41771c3dc607eca718ec238ee9a8f5254db`。aapt 核对显示名 ModMind、versionName 1.0.0-preview.1、versionCode 9、minSdk 29、targetSdk 35、ARM64；apksigner 验证通过，证书与原包一致。原始 versionCode 8 安装包另存 `release/archive/`，避免混淆两份 P1。
- OPPO 调试包覆盖安装成功，首次连接已读到工作台控件、原 7 个项目和登录状态；之后截图、CDP 和 RPC 因调试连接超时未完成。重连后再次超时，本轮完整的发布包数据保留回归未完成，不能引用上一轮记录作本轮通过证据。随后尝试恢复安装发布包也因连接超时中止，尚未确认测试机已恢复为不可调试发布版；交付文件本身是已核对的 release APK。

证据目录：`test-results/path-of-compatibility/`（原 P1 失败报告、修复后完整报告及本轮验证范围）。发布安装脚本按实际版本生成记录，开始前和安装后等待本地服务就绪；本轮未成功生成新的完整发布回归报告。

安装门槛仍为 Android API 29 / ARM64。API 扫描只覆盖 Java / Android 调用兼容性，不能代替旧系统原生 Node、JDK、WebView 的实际运行验证。本机可连接的 OPPO 是 Android 16；尚未在反馈用户的低版本安卓或鸿蒙真机验收，不承诺所有鸿蒙版本或所有安卓设备均兼容。
