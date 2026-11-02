# 安卓迁移功能对照（2026-11-02）

> 下表保留 0.3 对照时的基线；随后用户已授权继续实施。0.4 源码已加入完整项目导入/归档、容量受限的恢复点、项目检查与文件维护；AI 活动、思考与回放的新验收见 [过程迁移记录](AI-ACTIVITY-MIGRATION.zh-CN.md)。尚未迁移的配置、skills、附件等仍按稳定 MIG 行跟踪，不把过程展示完成等同整行完成。AUD-127 的移动类型债务随后已修复，当前移动 0 / 外部 3；首次纠错结果仍保留。

> 0.5后续：MIG-002/003/030中的提示词同步、领域skill按需读取、模型作用范围/推理/上下文与独立设置基础已实施，见[设置与AI同步](SETTINGS-AI-SYNC.zh-CN.md)。附件、所有技能依赖业务和桌面专用/未接设置仍未全部完成；原36行是历史差集，不重复重编号。

比对基线为当前 main 工作树，HEAD `7aca818cad68a4d90cc8daad9a11816e3d875351`；桌面 package 为 2.0.0-preview.1，安卓为独立试验版 0.3.0-pilot.3。工作树有大量既有修改，桌面“已有”指当前源码中的能力，不代表所有用户已经安装、启用或验收了对应功能包。

本轮是**模组制作、整合包制作两模式的迁移专题**，不是全应用缺陷复审。用户授权的产品改动仅为空白对话的正式 Logo；下表新增能力没有在本轮实施。能力行使用稳定的 MIG 编号，表示产品差异，不作为新的 AUD 漏洞。额外发现的检查脚本问题单独登记 AUD-127。

结论：当前安卓完成了“创建小项目 → AI/MCP 读写 → 本地编译/导出”的试验链路，还没有迁移桌面的完整创作流程。许多遗漏是尚未接服务、MCP 和手机交互，不能解释成安卓不支持。无云端开发环境并不阻止手机本地文件、HTTP、归档、JSON/SNBT 和轻量 WebGL 能力；在线 AI、搜索与下载仍需要网络。

## 已经迁移的基础

| 编号 | 能力 | 安卓当前实际范围 | 验证边界 |
| --- | --- | --- | --- |
| MIG-001 | 两制作模式 | 模组、整合包创建/切换；两者只有工作台、灵感台主入口 | 上轮两模式实际界面检查通过；不是桌面所有模板 |
| MIG-002 | 账号、额度与模型 | 网页授权、真实额度、模型目录与选择、自定义文字 API | 真实账号/目录上轮通过；自定义 API 余额不冒充已知 |
| MIG-003 | AI 与 MCP | Codex SDK/CLI、项目读写、停止、对话持久化、结果卡片 | 上轮真实在线读写成功；复合请求另遇免费线路 429 |
| MIG-004 | 文件与恢复 | 目录分页、已加载项筛选、文本创建/编辑、revision 冲突、上一版恢复 | 不是完整文件管理器；不能据此说支持任意文件类型 |
| MIG-005 | 本地构建与产物 | 内置 Node/JDK/Bash/Codex；Fabric 1.21.1 构建 JAR，mrpack 导出、单 JAR 导入/移出 | 有缓存构建验证；首次干净环境离线构建、游戏运行未验 |
| MIG-006 | 图片与模型基础 | 对话图片确认、PNG 显示/保存/移除历史；静态模型预览、首部件尺寸、源码 | 真实付费出图未验；模型不等于完整 Blockbench |

## 可以继续迁移但当前缺少的能力

“优先”表示解决手机独立工作主要阻断；“随后”表示已有主链后的扩充。成本是源码依赖与运行方式推断，不是已经完成安卓移植的承诺。

| 编号 | 桌面源码已有 / 用户任务 | 安卓现状与缺口 | 可迁移判断与必要取舍 | 顺序 / 代码依据 |
| --- | --- | --- | --- | --- |
| MIG-007 | 导入电脑已有项目、整体备份与恢复 | 只能新建手机索引项目；没有完整源码 ZIP 导入/导出；mrpack 是交付物，不是模组源码备份 | 可做本地归档 + 系统文件选择器，校验路径、大小、项目识别；不导入电脑的 .gradle/运行时 | 优先；E01、E03、E04 |
| MIG-008 | 项目重命名、复制、删除、快照 | 仅创建/选择；单文件上一版不能替代项目级恢复 | 可复用快照文件逻辑，增加空间限制、差异与回滚确认；无需云端 | 优先；E01、E05 |
| MIG-009 | 会话重命名、删除与管理 | 可新建/搜索/重开；没有改名、删除，最多 100 个对话后缺少维护入口 | ConversationStore 已有 rename/delete；增加受限 API、更多菜单和运行中保护即可 | 优先；E06 |
| MIG-010 | 给 AI 发图片、参考文件、选中文件上下文 | 输入接口只有文字；“添加项目内容”打开工具，不是附件提交 | 可接系统选择器、已有附件校验与 SDK 输入；限制大小/格式，模型不支持图片时明确降级 | 优先；E07、E02 |
| MIG-011 | 灵感整理为知识、制作提示词，预览/确认/撤销 | 只有普通只读对话和手工笔记；没有桌面结构化成果流程 | 复用 InspirationWorkflowStore 的来源核对、提交、确认与撤销，扩展 MCP；卡片留在对话中 | 优先；E08 |
| MIG-012 | 查询、搜索、定位项目内容 | 只能筛选当前已加载目录；没有项目全文搜索、文件重命名/移动/删除 | 可做有结果上限的索引/扫描；写操作继续走路径与 revision 校验，不需要新原生大环境 | 优先；E01、E09 |
| MIG-013 | 搜索并安装模组、按版本匹配、依赖补齐与更新 | 只支持手工选 JAR；没有 Modrinth/CurseForge 搜索、依赖计划、锁清单与升级闭环 | Node HTTP 与现有 ModProviderRegistry/计划器可复用；需要联网、下载取消/校验/事务；CF 的密钥与分发条件单独处理 | 优先；E10 |
| MIG-014 | 导入现成整合包 | 尚未接 mrpack、CurseForge ZIP 或外部实例导入 | 复用 inspect/materialize 服务，改掉桌面动态功能宿主调用；区分压缩包原有文件与需下载文件，展示大小 | 优先；E04 |
| MIG-015 | 整合包客户端/服务端侧别、依赖优化、冲突与版本计划 | 只保留简单 mods 清单和配置；没有侧别选择、完整锁清单审计、优化档与迁移计划 | 清单和计划可迁移；“优化建议”与真正启动性能实测必须分开，迁移先备份再应用 | 随后；E10、E11 |
| MIG-016 | 数据包配方、标签、掉落的表单、语义校验与 ZIP | 仅能手写支持后缀的文本；没有对应创建/回读/校验/导出工作流 | 当前 data-packs 已有 fs/Ajv/yazl 等服务，可迁移常见格式和限定版本；复杂结构保留源码，不称完整游戏验证 | 随后；E12 |
| MIG-017 | FTB Quests 编辑、校验、备份恢复 | 未接业务服务；通用文本后缀甚至不包含 .snbt，不能算已迁移 | 复用 ftbq-nbt/JSON5 及现有任务书服务；图标先用本地或小型基线，不自动下载整套游戏资源 | 随后；E13、E01 |
| MIG-018 | Patchouli 指南书、按键配置与冲突检测 | 可以手写 JSON，但没有相应任务表单、生成和检查 | 已有纯文件/JSON 业务，可作为对话卡片及临时编辑器接入 | 随后；E14 |
| MIG-019 | 物品、装备制作与原版参照 | 可让 AI 写代码，没有专属领域服务、版本化目录和生成校验 | 目录两份 JSON 合计 152725 bytes，适合内置；生成器可复用，贴图处理的 sharp 路径需替换或适配 | 随后；E15 |
| MIG-020 | 资源包创建、导入、文件管理、校验和导出 | 图片能写入项目、模型能预览，但没有资源包工作流 | JSON/ZIP/资源引用校验可迁移；PNG 先行，其他图片格式经 Android 解码或另选成熟组件，不直接假定 sharp 可用 | 随后；E16 |
| MIG-021 | 图片参考图编辑、自定义图片 API、尺寸/质量选择 | 当前仅账号单张 1024×1024；没有参考图、图片 API 设置及完整参数 | 联网请求本身可迁移；复用协议、权限、幂等和确认流程；不因迁移引入本地大模型 | 随后；E17 |
| MIG-022 | 像素处理、透明背景、图像基础编辑和节点工作流 | 只有生成结果显示与保存，尚无这几类能力 | 裁剪/缩放/PNG 像素操作可本地做；自动去背景要评估模型/WASM/服务成本；复杂节点 UI 另做窄屏任务设计 | 分步；E17、U03 |
| MIG-023 | 完整模型编辑、UV、贴图、动画、格式导出 | 当前是静态预览 + 简单尺寸/源码；没有完整建模与动画工具 | Blockbench 官方有适合手机/平板的 Web/PWA；具备迁移路径。须将 Electron WebContentsView 桥改为 Android WebView 并接回保存/MCP，不能直接复制桌面壳 | 分步；E18、U02 |
| MIG-024 | 项目依赖与联动库管理、映射查询、反编译 | 可以手改 Gradle；没有领域查询、托管依赖写入、映射/反编译入口 | 依赖与映射查询先迁；反编译工具可评估 JAR 执行，但大文件、Java 版本、输出体积必须实测 | 随后；E19 |
| MIG-025 | 更多 Java 模组/整合包目标版本与加载器 | 创建固定 Fabric 1.21.1 / JDK 21 | 模板/版本列表可先迁；Quilt/Forge/NeoForge 的编译组合、额外 JDK 和工具依赖需要矩阵实测，不能只放选项就称支持 | 分步；E20、E01 |
| MIG-026 | 国际基岩/网易内容生成、打包 | 当前没有对应项目类型 | JSON/脚本/清单生成与归档存在本地迁移路径；平台工具、客户端测试和分发条件单独评估，不承诺“一键通用” | 分步；E20 |
| MIG-027 | Git 版本与远程仓库 | 当前未打包 git，也没有 Git API | 桌面服务调用原生 git，不能原样运行；可选 Android git 或成熟纯 JS 实现。先本地历史，HTTPS/SSH/凭据、LFS、子模块分别验收 | 随后；E21、U04 |
| MIG-028 | 发布预检、版本说明和平台上传 | JAR/mrpack 可下载，未接发布设置、预检与上传 | 预检/说明生成可复用；平台 HTTP 上传可迁移但需要用户凭据与最终发布确认，不需要云端开发容器 | 随后；E22 |
| MIG-029 | 声音文件导入、预听、sounds.json 与转码 | 当前文本编辑可改 sounds.json，没有声音工作流 | 导入/预听/引用检查可先做；剪辑、OGG 转码依赖 Android 媒体实现或另打包 FFmpeg，体积与许可另评 | 分步；E23 |
| MIG-030 | 思考强度、制作偏好、skills 与执行计划、过程展示 | 模型选择/基础状态有；未迁移桌面配置、领域 skills 和完整过程/计划 UI | 偏好与适用 skills 可迁；仅展示实际服务/模型支持项。扩展受限 MCP 即可，不需要为此开放任意 shell | 随后；E07、E02 |
| MIG-031 | 灵感联网资料检索与引用 | 当前 Codex webSearchMode 明确 disabled，未接桌面 research 服务 | 可通过现有检索服务/HTTP 接入并保留来源；需要真实可用的联网供应商，不能假定所有文字 API 支持原生搜索 | 分步；E24、E02 |
| MIG-032 | 诊断导出、备份可携带、长期后台恢复与凭据保护 | 有受限日志/任务记录；无完整诊断 ZIP、Keystore 层及长时间后台验收 | 诊断/恢复可迁；Keystore 要 Android 原生桥。后台回收是 Android 约束，应持久化并恢复，不承诺永不被杀 | 优先收尾；E25、独立版验证记录 |

## 成本较高、应另做原型的边界

| 编号 | 能力 | 本轮判断 |
| --- | --- | --- |
| MIG-033 | 手机本地专用服务端、无渲染逻辑测试、服务端打包 | 已有 JDK 提供基础可能；需适配进程/网络/存储、测试启动及内存，不等于迁移不了。不能把桌面已过的测试当安卓通过 |
| MIG-034 | 手机上启动 Java Minecraft、画面观察、键鼠注入、客户端联机与自动测试 | 当前没有游戏运行时和对应原生图形/输入桥。需要安卓启动器/渲染方案与新一轮技术验证，不宜承诺桌面链直接运行 |
| MIG-035 | 本地游戏资源采集、世界/建筑大型预览 | 文件包读取和部分 Three.js 预览可评估；桌面探针启动与大世界占用需重做适配，不能顺带打包几 GB 资源 |
| MIG-036 | 全量桌面插件宿主 | 插件含 Electron API、原生工具与独立窗口，不能把已安装桌面插件复制进手机就运行。应逐业务复用并登记实际可用的 MCP 工具 |

独立的光影制作、服务端插件制作、完整皮肤工作台属于之前约定的两模式范围之外，本轮没有把它们全部列成遗漏。它们内部的通用资源处理能力仍可按具体任务复用。

## 推荐接入顺序与极简界面约束

1. 先补手机独立工作的保障：完整项目导入/备份、快照、文件维护、会话维护和 AUD-127 类型债务；解决“项目只能在手机创建、无法完整带走、堆满后难维护”。
2. 再补两条高频创作链：附件/图片输入 → 灵感成果确认 → 工作台执行，以及搜索模组 → 依赖/版本计划 → 安装/回读 → 导出整合包。
3. 内容领域逐个接：数据包 / FTB / Patchouli / 物品 / 资源包；图片与模型再扩充，不把所有桌面页面搬成手机标签。

主入口继续只有工作台与灵感台。新增能力通过 AI 可发现的领域工具、回复卡片、项目内容菜单和任务内临时编辑器交付。每项同时复用业务服务、接参数/边界校验与 MCP，并实际回读结果；仅隐藏页面或允许写 JSON 都不算该领域完整迁移。

## 源码与上游依据

路径相对仓库根；行号为本轮读取位置，后续开发可能移动。清单用于追溯静态判断，不冒充每个服务均在安卓执行过。

| 代号 | 主要读取入口 |
| --- | --- |
| E01 | android-mobile/backend/workspace.ts:16、:68、:258；android-mobile/src/ProjectTools.tsx:98、:130 |
| E02 | android-mobile/backend/server.ts:28–47；android-mobile/backend/ai.ts:22、:65、:69 |
| E03 | src/main/index.ts 项目与快照入口；src/main/archiveInspection.ts；src/main/safeExtractZip.ts |
| E04 | src/main/modpackImportService.ts:268、:462；src/main/modpackService.ts |
| E05 | src/main/snapshotStore.ts:46、:225；src/main/snapshotStorage.ts；src/main/index.ts:5725–5792 |
| E06 | src/main/conversationStore.ts:343、:357；android-mobile/src/StudioPanel.tsx |
| E07 | src/renderer/src/components/AgentWorkbench.tsx:278、:289、:327–365、:401–404；src/renderer/src/useAiAttachments.ts |
| E08 | src/main/inspirationWorkflowStore.ts:54、:102、:125；src/shared/inspirationSubmission.ts |
| E09 | android-mobile/src/CodeEditor.tsx；android-mobile/backend/workspace.ts 文本扩展名与目录分页 |
| E10 | src/main/modProviderService.ts:201、:328、:444、:490；feature-plugins/modpack-mods/src/main/modpackPlanner.ts:148、:279；src/main/modpackLockService.ts |
| E11 | feature-plugins/modpack-automation/manifest.json；feature-plugins/modpack-migration/main.ts |
| E12 | feature-plugins/data-packs/src/main/dataPackService.ts:43、:181、:207、:246、:262；src/shared/dataPack.ts |
| E13 | feature-plugins/ftb-quests/src/main/ftbQuestBookService.ts:174、:277、:370、:381 |
| E14 | feature-plugins/modpack-content/src/main/modpackContentService.ts:153、:252、:286、:313 |
| E15 | feature-plugins/item-editor/src/main/itemEditorService.ts:202、:233、:263；itemEditorGenerator.ts；itemCatalogBundled.ts 及 data/ 两份 JSON |
| E16 | feature-plugins/resource-packs/src/main/resourcePackService.ts:209、:225、:303、:357、:397 |
| E17 | feature-plugins/image-studio/manifest.json；feature-plugins/image-studio/src/main/imageStudioService.ts 及该插件 renderer 编辑器；android-mobile/backend/assets.ts |
| E18 | feature-plugins/model-studio/src/main/blockbenchBridge.ts:11、:1053、:1075；安卓 src/ModelInspector.tsx、backend/assets.ts |
| E19 | feature-plugins/relationships/src/main/dependencyService.ts:326、:342；mappings/decompile 功能清单 |
| E20 | feature-plugins/studio-mod/manifest.json；feature-plugins/studio-mod/src/main/modTemplates.ts:778；studio-modpack/manifest.json |
| E21 | feature-plugins/versions/src/main/gitService.ts:119–160 |
| E22 | feature-plugins/publishing/src/main/releaseService.ts:254、:297、:439 |
| E23 | feature-plugins/sound-studio/src/main/soundFiles.ts:4、:52；sound-studio/manifest.json |
| E24 | src/main/inspirationResearch.ts；src/main/webResearch.ts；安卓 backend/ai.ts:69 |
| E25 | src/main/diagnosticArchive.ts；安卓 RuntimeService.java、BundledRuntime.java、backend/account.ts |

- U01：[Modrinth 搜索 API](https://docs.modrinth.com/api/operations/searchprojects/) 支持项目与版本条件，证明不必另造搜索后端；本轮没有请求真实下载。
- U02：[Blockbench 官方 Web/PWA 说明](https://blockbench.net/wiki/guides/blockbench-overview-tips/#progressive-web-app) 明确提及手机、平板与离线 PWA。可嵌入的推断不等于 ModMind 的 Android 文件桥与 MCP 已适配。
- U03：[sharp 安装说明](https://sharp.pixelplumbing.com/install/) 的现成二进制平台不含 Android；因此当前不能简单复制桌面 sharp 依赖，但也不能据此否定基础图像编辑。
- U04：[isomorphic-git](https://isomorphic-git.org/en/) 提供 Node/浏览器纯 JS Git，是可评估替代；本轮未引入依赖，也未验证其全部功能与桌面 Git 等价。

## 覆盖矩阵和未验证范围

| 领域 | 检查深度 | 结果 / 未验证 |
| --- | --- | --- |
| 品牌空态 | 实际源码改动、APK 构建/86 ELF/21 资源核对、OPPO 两模式、深浅主题截图 | Logo 56×56、自然资源 512×512，加载成功、360px 无横向溢出；原主题已恢复 |
| 两模式、账号、AI、文件、图片、模型 | 当前路由/界面/业务源码与上轮真实验收记录交叉读取 | 已有基础与缺项分别登记；本轮未重跑在线 AI、付费图片、构建和导出 |
| 项目/会话/备份与版本 | 读服务、操作和移动端 schema 差集 | 可迁移判断为静态推断，未实施新入口 |
| 模组平台/依赖/导入/迁移/发布 | 功能清单与实际业务服务、HTTP/归档依赖 | 未做安卓下载、CF 密钥联调、迁移或发布 |
| 数据包/FTB/Patchouli/物品/资源包 | 读实际文件服务、格式/校验依赖与移动端文本限制 | 未执行这些新领域的安卓 MCP/交互或真实游戏 |
| 模型完整编辑/图片处理/声音 | 对照桌面 Electron、sharp、媒体程序依赖，查官方上游 | 未把上游 Web/PWA 宣传等同集成完成；没有新增模型权重/媒体二进制 |
| 游戏测试/采集/全插件宿主 | 清单与运行方式边界 | 仅成本/架构判断，未声称已解决安卓渲染、输入、后台与全版本兼容 |
| 类型验收 | 原脚本与规范化路径诊断重跑 | AUD-127：修正脚本后移动端 60、外部 3；检查失败，业务类型问题尚未修复 |

Logo 修订 APK：281870172 bytes，SHA-256 `69597be7fd3bc172fcefa11a12197cc374635dd23ce80dc3114761a47694d483`。与上轮运行时相同（runtime.bin 410187 bytes），品牌 PNG 为复用资源，新增约 97 KB；ADB 安装 Success。证据保存在忽略的 test-results/logo 与 test-results/logo-typecheck.log。

## AUD-127：类型检查误分类及验收纠错

触发条件：Windows 下 root 使用反斜杠，而 TypeScript diagnostic.fileName 使用正斜杠，原 `fileName.startsWith(root + path.sep)` 将移动源码诊断全部错计到 externalDiagnostics。结果是上轮 0/63 的统计不能证明移动端类型检查通过。

本轮已用 path.resolve 规范化文件路径，并加入正常的 vite/client 资源类型声明入口；重新执行得到 **mobileDiagnostics=60、externalDiagnostics=3，退出 1**。移动问题集中于 PNGJS 声明、Ajv 校验后的 unknown 收窄、任务取消分支的 undefined 收窄。本轮未修这些业务类型问题，没有用 any 或删检查将其变成“通过”。对应上轮记录已加纠错，既有真实运行检查与静态类型结论分开保留。

这是检查可靠性缺陷和类型维护债务，不等于已经复现了 60 个手机运行故障。修复边界：脚本分类及 Logo 资源类型已修，60 项业务诊断待单独处理；旧验收 0 诊断结论撤回。
