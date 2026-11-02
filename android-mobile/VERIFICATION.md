# Android 独立试验版验证

2026-11-02 P1 旧安卓启动修复：替换仅 API 34 起可用的 Path.of，保持 minSdk 29 和 P1 显示版本，内部 versionCode 9。已复现原完整 lint 的 NewApi 错误；修复后 debug/release 完整 lint 均 0 错误、7 警告，安装包签名、资源和 dex 核对通过。OPPO 调试包覆盖及首次工作台/项目/登录读取成功，随后连接超时，完整发布回归与旧安卓/鸿蒙实机仍未完成，详见[兼容记录](ANDROID-COMPATIBILITY.zh-CN.md)。

2026-11-02 后续：设置按 apple-design 调整，接入桌面模型列表与扫描；真机扫描51个可用模型且保留三处选择。成品新增原生分享，最终0.6.1-pilot.7已安装，JAR导出哈希与微信/QQ系统目标检查通过，详见[本轮记录](MODEL-PICKER-UI.zh-CN.md)。游戏运行与真实联系人发送均未验证。

**2026-11-02 纠错（AUD-127）：下文历史记录的“移动端严格检查 0 / 外部 63”结论撤回。原脚本没有规范化 Windows 路径；首次纠正为移动端 60 / 外部 3、退出 1。随后用户授权继续迁移，已修复这 60 项移动诊断，当前真实分类为移动端 0 / 外部 3；外部项均为既有 soundStudio/jfxr 类型，不冒充全仓通过。历史错误统计不追认有效。详见 [过程迁移与新验收](AI-ACTIVITY-MIGRATION.zh-CN.md) 和 [原迁移对照与纠错](MIGRATION-GAPS.zh-CN.md)。**

## 2026-11-02 0.4 基础功能与 AI 过程迁移

后续0.5已安装并完成提示词/Skills/模型作用范围/独立设置的授权迁移。17类原文48文件、按需MCP、真实切换与恢复、六项桌面偏好重启回读、768MiB离线缓存构建、7组设置服务/7组浏览器/6组手机检查均有独立记录；全量未支持设置、最终APK哈希与检验范围见[0.5实施与设置对照](SETTINGS-AI-SYNC.zh-CN.md)。此更新不把下方早期范围自动追认为全量迁移完成。

完整项目导入/源码归档、128 MiB 全局与每项目 3 点的增量恢复、文件搜索/移动/移除、静态检查与 Gradle test/JUnit 结果分层已接入服务和 MCP；18 项新服务回归与 46 项原服务回归通过。新项目管理/系统选择器的完整真机验收仍单独跟踪，不能用 AI 过程 UI 代替。

AI 过程改为内置 Codex app-server 优先，复用桌面活动映射、思考概要/正文、时间线回放与折叠组件；保留只读、原位结果和停止语义。手机原生协议夹具、真实在线只读 MCP、共用桌面 48 项和新映射回放 8 组通过。真实在线这一条未返回思考字段，不伪造展示；返回思考时的链路由原生协议夹具验证。具体实际截图、APK 和未验范围见[专项交付](AI-ACTIVITY-MIGRATION.zh-CN.md)。

## 2026-11-02 Logo 修订

空白对话的装饰星号已替换为桌面正式品牌资源 src/renderer/src/assets/logo.png，工作台与灵感台共用，固定 56×56 CSS 像素，无额外标题或入口。APK 已安装到 OPPO；两模式自然图片尺寸 512×512、加载成功、360px 无横向溢出，深浅主题实际截图已检查，原浅色主题已恢复。证据为 test-results/logo/ui.json、light.png、dark.png。

本轮 APK 为 281870172 bytes，SHA-256 69597be7fd3bc172fcefa11a12197cc374635dd23ce80dc3114761a47694d483；86 ELF、21 资源和原运行脚本核对通过，ADB 安装 Success。纯视觉改动没有新增 MCP，也没有重跑收费模型、图片或完整业务矩阵。类型检查失败及 60 项业务诊断见上方纠错；不能把构建/显示通过写作类型通过。功能差集另见迁移对照，表中新增能力本轮未实施。

日期：2026-11-01 至 2026-11-02（北京时间）。OPPO Reno12 Pro，Android 16，ARM64，360×764 CSS 像素。早期依赖 Termux 的验证已归档在 VERIFICATION-pilot-1.md，不能作为当前独立环境证据。

## 独立迁移第一轮已完成

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 原生环境 | 在 dev.modmind 自己的 UID / target SDK 35 下启动 Node 24.22.2、Java/javac 21.0.13、Bash 5.2.37、Codex CLI 0.154.0，全为 exit 0 | runtime-probe.json；Java 路径适配源码 android/runtime-paths.c |
| 独立启动 | 停止 com.termux 后，应用自动启动自己的前台服务；更新与 force-stop 重启后账号、项目、对话保留 | scripts/test-independent-final.mjs；test-results/independent/final.json |
| 实际构建 | 应用界面发起，自己的 JDK + Gradle 9.5.1 / Loom 1.17.17，15.757 秒完成；JAR 含类、fabric.mod.json 与 PNG | 同上，wrapper-probe.json，artifacts.json |
| JAR 导出 | MediaStore 保存下载目录后拉取核对，2703 bytes，SHA-256 dc9a37adc80dd48450cdc26487b36643ae173d6c8854d46b98241a56a32d6162 | final-mod.jar；artifacts.json |
| 整合包 | 系统文件选择器导入同一 JAR，界面导出 mrpack；解包含配置与完全相同 JAR | final-pack.mrpack，2155 bytes，SHA-256 1b92ac6aa93e48c26cafbc801f92301d4e5a9d9697d4ff81c2d6dd5c783ff2da |
| 账号与额度 | 用户在手机完成真实设备授权；额度接口返回合法余额；供应商目录 20 个模型，连接有效、非陈旧，当前免费线路 | account-usage.json / account-catalog.json（私有证据，不提交账号明细） |
| 在线 AI 只读 | 内置 Codex 实际调用只读 MCP 读取 README，正确回复中文项目标题 | online-ai.json |
| 在线 AI 写入 | 真实模型通过 MCP 保存 docs/android-online-check.json 并回读 {"onlineOnPhone":true}；第一次参数不符合 schema 被拒后重新读取再成功 | online-write.json |
| Codex 协议 | 本地无收费 fixture 走完整 SDK → MCP read → write → 持久对话，非模拟 Codex 自身 | scripts/test-independent-ai.mjs；codex-fixture.json |
| 触摸界面 | 两模式创建/进入，模型旋转预览、尺寸保存、知识保存，浅深主题与键盘、360px 无横向溢出 | test-independent-ui.mjs，ui.json 与实际截屏 |
| 图片 | 手机 PNG fixture 预览、保存项目、确认/取消删除；JSON/SSE 完成图、图片 MCP、拒绝覆盖/越界、重启中断不自动重发经实际服务验证 | test-independent-final.mjs；scripts/test.mjs |
| 图片服务只读查询 | 真实服务显示 ls / gpt-image-2 可用；本轮未消耗真实出图额度 | provider 查询记录；真实生成尚未验收 |
| 服务检查 | 43 项通过，含原有项目、导入导出、历史冲突、MCP 以及新增对话/笔记/模型/图片边界 | npm test；backend-verification.json |
| 类型（历史结果已纠错） | 原 0 / 63 为路径误分类，不能作通过证据；规范化后移动 60 / 外部 3，检查失败 | AUD-127；npm run typecheck |
| APK | 281729333 bytes，SHA-256 e2a829c4facb978bc3259dbc37b0dde1ac1c1355766ad7a8c6e60290dca116fa；86 个 ELF、脚本 ZIP 和 13 份资源核验通过，已安装 | scripts/verify-apk.mjs |

构建缓存由旧探针复制约 531 MiB 到新应用私有目录，仅用于测试，不在 APK 内。无干净新机首次断网编译承诺。基础环境无需 Termux，但 AI/图片依赖在线服务。没有启动 Minecraft。没有测试长时间锁屏、低内存系统回收、所有输入法/安卓型号和付费线路切换，也没有做断开 USB 后长时间连续使用。凭据当前依赖 Android 私有数据隔离，未接独立 Keystore 层。公开发行前还需发布签名及原生 GPL 对应源码整理。

## 极简 UI 优化

已完成并安装 `0.3.0-pilot.3`。改动全部位于 android-mobile，沿用现有独立环境，没有调整桌面入口。以下为最终 APK 的真机结果。

| 之前 | 现在 | 原因 |
| --- | --- | --- |
| 工作台之外另有图片、模型、账号等常驻入口 | 主界面只显示工作台 / 灵感台与一个输入框 | 保持手机创作主线简单 |
| 用户离开对话查找工具结果 | 图片确认、模型预览、保存文件和构建下载直接附在原回复 | 保留任务上下文 |
| 账号和模型目录需要分步展开、手动读取 | 输入框旁选模型；账号弹层自动读取有容量与失效限制的目录缓存 | 减少重复操作 |
| 文件与模型独立占据主页面 | 临时弹层打开文件、知识、构建记录、模型及源码，关闭回原对话 | 保留必要能力，收起次要界面 |
| 运行细节与原始工具名占据正文 | 过程折叠、中文状态、Markdown 回复，错误保留重试路径 | 降低阅读负担 |

| 验证 | 结果与证据 |
| --- | --- |
| 12 项界面交互 | scripts/test-minimal-ui.mjs 全通过；模组与整合包共用同一界面，只有两个主入口；文件实际写入、项目知识、历史搜索、账号单一标题、主题与原生返回均验证。test-results/minimal/ui.json |
| 键盘与窄屏 | 原生键盘展开后视口 360×462，输入区底部 450；页面 scrollWidth=360。源码在编辑器内部滚动。无页面横向溢出、无 pageerror |
| 模型与只读 | 项目中的真实 .bbmodel 打开 Three.js 画布，再进入可编辑源码；灵感台不显示保存尺寸，源码不可编辑。model-sheet-dark.png / model-source-dark.png |
| 6 项结果卡片交互 | scripts/test-minimal-results.mjs 全通过；手机上实际调用现有 MCP 的 model_preview、image_draft、离线 build。点击模型卡后回原对话；实际构建完成后由卡片经 MediaStore 保存 JAR；刷新保留对话与卡片 |
| 图片结果 | 对话明确标注“本地测试响应”，注入 16×16 PNG 仅验证显示、项目保存、删除确认与取消。没有调用真实生图。删除后刷新保留终止回执，不出现再次生成入口；项目贴图仍在。results.json / inline-image-dark.png |
| 触摸回归修复 | 原生点击发现更多菜单遮挡图片保存按钮；改为独立的弹性布局空间，最终测试断言二者矩形不相交，并实际点保存成功 |
| 服务回归 | 最终 46 项通过，增加请求幂等、已删除回执重载与再次提交不收费、只读图片提案参数等验证。test-results/backend-verification.json |
| 类型（历史结果已纠错） | 原统计漏识别移动源码；规范化后移动 60 / 外部 3，退出 1。业务类型问题未修，详见 AUD-127 |
| 打包与安装 | APK 281772935 bytes，SHA-256 fbee4029f9a87c3360d9c24f55b33cd5fa441ca8f6a2a1344d5589964ce08997；86 个原生 ELF、20 份资源、脚本 ZIP 与当前构建逐项一致。ADB 安装 Success，安装后重新启动验证 |
| 收尾快照 | 真实账号仍连接，两个项目保留，检查的 10 个历史对话及构建/图片均无运行任务，Termux 未运行。test-results/minimal/final.json。随后界面留在新的空白工作台对话 |

在线能力的真实读取、写入、额度与授权证据仍见第一轮。极简 UI 的复合在线请求遇到免费模型 HTTP 429，未切换付费线路；一次提前结束的模型调用也保留了失败记录。图片提案支持可选 title 后已通过真实手机 MCP 调用，但没有将本地结果卡片 fixture 冒充“在线模型完整执行整条复合请求成功”。真实付费出图仍未验收。

最终界面截图位于 test-results/minimal：workspace-light.png、workspace-dark.png、keyboard-light.png、file-sheet-light.png、model-sheet-dark.png、model-source-dark.png、history-dark.png、modpack-dark.png、inline-image-dark.png。已检查实际画面；账号截图和明细属于本机忽略的私有测试证据，不应公开提交。第一轮记录中的环境、首次下载、长时间后台、公开发行等边界继续适用。

收尾已恢复保持唤醒设置为原值 0，移除本轮 19087 / 19223 转发，清理临时测试程序与图片；早期 3 张本地测试提案补存终止回执，避免清理后重新出现收费生成入口。北京时间 2026-11-02 00:12:25 执行用户授权的 `adb -d shell reboot -p`，exit 0、返回 Done；延迟检查确认设备从 ADB 断开（no devices found）。记录位于 test-results/minimal/shutdown.json。未要求用户夜间继续协助。
