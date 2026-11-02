# ModMind 安卓独立试验版

当前仅提供模组制作、整合包制作两个模式的基础工作流。应用标识 `dev.modmind`，安装门槛为 Android 10 / API 29、ARM64；与早期 `dev.modmind.mobile.pilot` 并存。低版本系统的实际兼容验证范围见[安卓兼容记录](ANDROID-COMPATIBILITY.zh-CN.md)。没有更改桌面入口，也没有删除旧版项目。

## 当前界面

0.5新增独立“设置”，从项目菜单进入；模型快捷入口仍在输入框旁，可选择全局默认、工作台或灵感台。桌面提示词与17类技能原文随打包同步，通过MCP按模式和当前能力读取。设置包含有效的模型/推理/上下文、外观、补充提示词/Skills、审批/构建和缓存；未接桌面项逐项列在对照页，详见[实际迁移范围与最终验收](SETTINGS-AI-SYNC.zh-CN.md)。下表保留基础原型范围，不能据此说桌面全部设置与业务已迁。

主页只有 **工作台 / 灵感台** 两个入口：顶栏显示当前项目，历史与新对话按需打开，底部是一个输入框。项目切换、制作模式与账号在菜单里；模型选择在输入框旁。没有图像、3D、文件或构建的独立主页/常驻标签。

图片由 AI 调用 image_draft 准备对话内确认卡，用户点击“生成图片”才申请额度；结果直接出现在原卡片。相同卡片请求在 7 天保留期内幂等，重开、重载不重复生成；图片卡片的更多菜单可移除历史原图，保留项目贴图和请求回执。3D 模型通过回复卡片或项目文件打开预览，也可继续打开源码，关闭即返回原对话；构建产物可直接从回复卡片下载。文件、知识、构建记录使用当前对话内的临时弹层，主界面没有工具面板。灵感台的文件和模型检查保持只读。

回复使用仓库现有 Marked 15.0.7 + DOMPurify（锁定版本）渲染与净化 Markdown，不保留原始 HTML 事件或远程图片；未另写 Markdown 解析器。模型、编辑器、文件工具均延迟加载。工具过程默认折叠为简短中文状态，原始 MCP 名称、运行时提示和 token 数据不占聊天正文。

## 当前范围

| 能力 | 已迁移 | 当前取舍 |
| --- | --- | --- |
| 工作台 AI | 登录账号、实际模型对话、MCP 项目读取与保存、构建/导出工具、持久历史、停止、结构化回复卡片 | 内置 Codex；没有桌面全部代理、插件和审批界面。原生命令与直接补丁工具关闭，项目修改经过 MCP |
| 灵感台 | 只读对话、历史、手动保存项目知识 | AI 只读会话不能改项目或笔记；手动知识与工作台共享 |
| 账号、额度、模型 | 网页设备授权、真实额度刷新、同步供应商模型与收费线路校验；自己的 API | 自定义 API 的余额由服务商统计；图片服务目前使用 ModMind 账号，不继承自定义文字 API |
| 模组制作 | Fabric 1.21.1 模板、代码/配置编辑、恢复、手机 JDK 21 构建与 JAR 下载 | 没有 Forge/NeoForge、游戏启动和游戏内测试；首次 Gradle/Maven 依赖需联网 |
| 整合包制作 | 创建项目、系统选择 JAR、移出/重新导入、配置编辑、标准 mrpack 导出 | 不接管外部实例，不关联桌面模块，不内置模组商店 |
| 图像工坊 | 对话内确认单次一张 1024×1024、完成图 PNG 解码、历史、预览、保存到项目；JSON/SSE 响应 | 用户在对话卡片点击生成才申请图片授权，不自动重试。没有参考图编辑、去背、像素优化、JPEG/WebP 解码；真实服务出图单独记录 |
| 3D 模型 | .bbmodel/直接 Java 几何体列表与路径打开、旋转缩放预览、新建立方体、首部件尺寸修改、源码编辑 | 使用已有场景渲染，不移植整个 Blockbench；静态、512 部件上限，外部贴图与 Java 贴图降级为素色，无动画、YSM、蒙皮工具 |

## 独立环境与数据

Node 24.22.2、OpenJDK 21.0.13、Bash 5.2.37、Codex CLI 0.154.0 及依赖原生库随 APK 打包。可执行 ELF 位于 Android 安装的 native library 目录，JDK 逻辑目录通过链接及 `android/runtime-paths.c` 适配；保持 target SDK 35，没有通过降低目标 SDK 绕过可写目录执行限制。Node 的 V8 快照不作字符串改写。

Codex CLI 的 [官方安装文档](https://developers.openai.com/codex/cli) 没有承诺 Android 支持。本试验使用锁定的官方 ARM64 musl 二进制，已在这台 OPPO 的应用 UID 下验证 CLI、SDK、真实在线模型及 MCP 读写；这是本项目的设备适配结果，不能据此承诺所有安卓设备兼容。

启动后由应用自己的前台服务运行 Node，页面通过受限原生桥访问手机 loopback 19086；不要求安装或运行 Termux，不由电脑、云端托管项目环境。状态通知可以停止环境。系统仍可能回收进程，不承诺锁屏永久保活。构建直接调用官方 Gradle wrapper JAR，避开 Android toybox 与桌面 shell 参数处理的差异。

项目、账号和历史位于应用私有目录，禁止 Android 自动备份；账号凭据不返回给网页/MCP，页面只显示状态和目录。当前凭据文件依赖 Android 应用数据隔离，尚未增加独立的 Keystore 加密层。卸载独立版会删除该应用的私有数据；旧试验版数据仍归旧应用/Termux。产物用 MediaStore 保存到 `下载/ModMind`，JAR 通过系统文件选择器导入，不申请全盘访问权限。

基础项目创建、查看、编辑、笔记和模型预览的运行环境已内置。**AI 与图片仍需在线模型服务**；“没有云端环境”指不需要远端开发容器，不是把大模型权重放进手机。Gradle、Minecraft 开发依赖和映射不全部装入 APK；首次构建可能下载数百 MB。默认离线构建，缺少依赖时在构建页关闭该选项再主动重试。不会为了预览下载整套游戏资源。

本次独立构建测试复制了此前工具链探针的约 531 MiB 构建缓存到新应用私有目录；这份缓存**没有进入 APK**。因此不能把缓存构建通过称为干净新机首次断网即可编译。

## 复用和选型

| 组件 | 来源/许可 | 选择依据与离线成本 |
| --- | --- | --- |
| 账号/额度/路由 | 本仓库 deviceIntegration、ProviderSyncService | 复用多供应商同步、精确模型与收费线路校验，避免另外实现计费协议 |
| 对话/知识 | 本仓库 ConversationStore、WorkbenchDataStore、InspirationKnowledgeStore | 复用项目绑定、原子写入、对话日志和镜像恢复；不是另一套聊天 JSON 格式 |
| 模板、整合包、路径 | 本仓库 modTemplates、modpackService、scopedFilePath | 真实 Fabric 模板与 mrpack 服务；共享冲突和目录边界 |
| Codex CLI / SDK 0.154.0 | [官方 SDK](https://developers.openai.com/codex/sdk)，Apache-2.0 | CLI 与桌面锁定版本一致，ARM64 npm 归档 SHA-512 校验；SDK 复用续聊、取消及 MCP 执行。CLI 原始 ELF 约 227 MB，是包体增长的主要部分 |
| Android Bionic Node/JDK | [Termux packages](https://github.com/termux/termux-packages)，Node MIT，JDK GPL-2.0 + Classpath exception，Bash GPL-3.0 | 直接使用成熟 Android 二进制；仅在构建机采集时需要 Termux。ELF 路径重定位规则、源归档 hash 及版本有记录，APK 运行时不调用 Termux |
| AndroidX WebKit 1.13.0 | Apache-2.0 | 本地 HTTPS 资源源与受限文件桥；不引入 Electron/整套跨端框架 |
| CodeMirror 6 | MIT，package-lock 锁定版本 | 复用触摸编辑、语法、撤销；编辑器懒加载约 597 KB JS |
| Three.js / 项目场景服务 | 仓库锁定版本，MIT | 复用现有几何体、UV 和 OrbitControls；模型页懒加载约 513 KB JS，不重复实现模型渲染 |
| PNGJS 7.0.0 | [上游](https://github.com/pngjs/pngjs)，MIT | 纯 JS PNG 解码，代替没有当前 Android 构建的 Sharp；有 CRC、像素和容量限制 |
| eventsource-parser 4.1.3 | [上游](https://github.com/rexxars/eventsource-parser)，MIT | 复用分块 SSE 解析，仅保存完成图，不将局部预览冒充结果 |

原生组件许可与 JDK legal 文件随运行资源保留，JS 许可与 Codex LICENSE 合入 APK 的 THIRD_PARTY_NOTICES.txt。公开发行前仍需整理 GPL 组件的完整对应源码交付和发布签名；当前输出为内部调试包。

## MCP、权限和容量

现有 stdio 服务原样打包，提供 `modmind_mobile_query`、`modmind_mobile_write`、`modmind_mobile_task`、`modmind_mobile_studio`。studio 复用笔记、模型、图片业务服务；图片生成只在对话卡片确认后触发，移除历史由卡片菜单处理。工具参数由 Ajv 校验，会话绑定单项目、有效期 24 小时，最多 32 个；过期配置清理。只读调用层拒绝写入，即使工具名被直接猜出也不能越权。保存必须携带读取所得 SHA-256 revision。原生 Codex shell、apply_patch 关闭，只批准当前受限的 ModMind MCP 服务；这不等于恶意 Gradle 脚本的操作系统沙箱。构建使用用户信任的项目内容。

目录每页 100 项、项目最多 256 个、文本 256 KiB、文件草稿 4 份、消息草稿 8 份/7 天、每项目知识 100 条、对话 100 个、单对话 2000 条事件（界面最多暂存 500 条）。文件恢复保留最近 32 个文件的上一版。单次 JAR 64 MiB；图片每项目 32 张、单 PNG 20 MiB/16777216 像素。模型贴图总像素受限。图片请求回执最多 128 份/7 天。只同时运行一个 AI、一个构建、一个图片任务；AI/构建 20 分钟、图片 5 分钟。构建日志保留末尾 32 KiB，服务日志 256 KiB；任务/产物有数量和有效期限制。

## 构建和复现

根仓库依赖沿用现有 lockfile，本目录依赖用 `npm --prefix android-mobile ci` 安装。运行时二进制是忽略的构建输入，不在源码仓库分发；需要先准备：

1. 构建用 ARM64 Android/Termux 安装锁定的 nodejs-lts、openjdk-21、bash、ca-certificates-java；采集脚本只用于构建，不是最终用户安装步骤。`node android-mobile/scripts/capture-runtime.mjs` 生成私有构建归档。
2. Python 安装 pyelftools，执行 `prepare-bundled-runtime.py --elftools <pyelftools 所在目录>`。元数据含每个原生输入 SHA-256；与 runtime-lock.json 对照，更新输入应重新验收。
3. 构建机 Termux 安装 clang 后执行 `node android-mobile/scripts/build-path-adapter.mjs`。也可用 Android NDK 按同样源码编译共享库，输出名 libmm_runtime_paths.so。
4. 下载官方 npm ARM64 包 `@openai/codex@0.154.0-linux-arm64`，将 tgz 路径交给 `node android-mobile/scripts/prepare-codex.mjs <归档>`；脚本按桌面 descriptor 校验 SHA-512 再提取，不接受未验证的镜像文件。
5. 执行 `npm --prefix android-mobile run build`、`test`、`typecheck`、`apk`。APK 需要 JDK 17+、Android SDK/Build Tools 35；Windows 使用校验过的 ASCII 暂存目录。设置 ANDROID_SDK_ROOT / MODMIND_ANDROID_TOOLS 可覆盖本次机器的默认工具路径。

默认输出 `android/app/build/outputs/apk/release/app-release.apk` 与根仓库 `release/ModMind-Mobile-<版本>-arm64.apk`；`-Variant debug` 生成调试包，`-Variant both` 生成两种包。打包对各变体执行完整 lint，API 兼容错误阻断构建，报告保存在 `android/app/build/reports/`。构建后逐个核对 APK 内 86 个 ELF、脚本 ZIP、页面资源和许可，避免构建过程剥离或替换工具。设备、授权、截图和临时项目放在忽略的 test-results/state 中，不提交令牌或账号数据。

实际通过和仍未验证的范围见 [VERIFICATION.md](VERIFICATION.md)。早期依赖 Termux 的结果保存在 VERIFICATION-pilot-1.md，不能代替独立版验收。
