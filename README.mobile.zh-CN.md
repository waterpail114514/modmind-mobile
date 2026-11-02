# ModMind Android

安卓开发分支：codex/mobile。工作目录：E:/waterpail/桌面/新建文件夹/modmind-mobile。当前目录是同一Git仓库的独立worktree，与桌面共用提交历史。

应用显示名为 **ModMind**，当前版本 **1.0.0-preview.1**，Android versionCode 为8；安装ID仍为dev.modmind，沿用原签名以支持覆盖试验版和保留数据。发布包关闭Android调试与WebView调试。这是直接分发的预览签名方案，尚未配置商店上架签名。

当前安装包：[ModMind-Mobile-1.0.0-preview.1-arm64.apk](release/ModMind-Mobile-1.0.0-preview.1-arm64.apk)，配套.sha256文件位于同目录。release目录不入Git。

## 开发与打包

实现入口在android-mobile/；src/、部分feature-plugins/与resources/保留安卓实际复用的共享能力及原Git历史。本分支按安卓脚本验收，不表示桌面完整应用的全部开发改动都已迁入。桌面原目录../modmind保留其main分支和其他工作。

本机根node_modules通过目录链接复用桌面已有依赖，安卓自身node_modules、运行时源和构建素材已随目录迁移。新机器可在根目录和android-mobile分别npm ci，随后按android-mobile/README.md准备原生运行时；不需要读取兄弟桌面目录的业务源码。

```powershell
node android-mobile/scripts/typecheck.mjs
node android-mobile/scripts/build.mjs
node android-mobile/scripts/test.mjs
node android-mobile/scripts/test-settings.mjs
node android-mobile/scripts/test-mobile-motion-browser.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File android-mobile/scripts/build-apk.ps1
```

打包默认生成release；-Variant debug供真机WebView调试，-Variant both生成两者。既有依赖缓存、SDK/JDK路径和安全暂存规则沿用构建脚本。调试密钥不要提交或公开，签名文件仍在用户原有.android目录。

桌面精调提示词中的两段工作流在分支拆分时原样保存为android-mobile/shared/desktopWorkflowSource.ts，避免为提取常量带入桌面主进程入口的其他改动。其余提示词、身份与17类skills来自本分支共享模块/资源，完整指纹仍为8b32286d248f66ead7bb4316a7c9e2d8eb0e23d3e2d22712b62ed6cdbf989b78。将来同步桌面时应明确审阅和更新该工作流源，不自动读取兄弟目录。

## 本轮动画

依照apple-design和animate，复用现有原生dialog与布局，接入Motion 14.9.0（MIT）。底部弹层使用250ms、无回弹的弹簧，沿进入路径退出；设置页面180ms、工作台切换150ms，只处理transform/opacity。关闭动画保留DOM至退出结束并使旧控件inert；键盘操作即时，减少动态效果只保留短淡入淡出。没有增加自动滚动动画、拖拽手势或AI工具。

实现依据：[Motion AnimatePresence](https://motion.dev/docs/react-animate-presence)、[减少动态效果](https://motion.dev/docs/react-accessibility)。主入口JS压缩后增加约49 KiB，没有增加新的原生库。

## 验证与边界

- 新目录手机服务48项、项目导入/快照/MCP18项、设置/skills/MCP7组、AI过程回放8组通过；移动源码类型诊断0，既存外部诊断3。
- 设置浏览器7组、模型浏览器6组、动画浏览器5组通过；动画覆盖中间帧、退出、重复打开关闭、未保存草稿、320px及减少动态效果。
- OPPO Android16真机动画5组通过，观察到多个中间transform帧；Android返回、工作台/灵感台和上下文窗口交互可继续。证据android-mobile/test-results/motion-phone/。
- debug与release资源核对均为36项、86个原生组件。release lint已通过，修复了loopback域缺少includeSubdomains属性的发布检查问题。
- 源码迁移保留桌面其他暂存内容；安卓自身源、原生运行时素材、测试记录已移到本目录。共享源码在桌面侧保留，避免删除其他工作。

真实账号/模型/额度、游戏运行与全部第三方分享接收端并未在本轮重新做完整矩阵；上一轮结果与未实现功能见android-mobile/的既有迁移记录。新动画没有扩大业务覆盖范围。

最终发布包已在OPPO覆盖安装：debuggable=false，账号、三处模型偏好、7个项目和全部设置回读一致。APK为272035915 bytes，SHA-256 fd91dae4cb09647c5728dd4ae4743412e54fa12d8546195e58da8bad43a3f4a8。证据android-mobile/test-results/preview-release/result.json。Codex侧栏项目modmind-mobile及本对话归属已核对。
