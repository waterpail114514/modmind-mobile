# 安卓试验版验证记录

日期：2026-11-01。当前是小范围开发试验，不是完成迁移的正式手机版。

## 已通过

| 层级 | 实际验证 | 证据 |
| --- | --- | --- |
| 共享业务服务 | 28 项实际服务测试通过：真实模板建项目、根目录空路径与文件空路径区别、保存与回读、版本冲突、历史恢复、JSON/大小限制、父目录与链接越界、应用索引保护、只读与会话项目范围、JAR 导入/移出/重新导入、mrpack 真实内容、外部关联模块拒绝、大目录分页、产物范围 | `scripts/test.mjs`；`test-results/backend-verification.json` |
| MCP | 现有 stdio 服务 initialize → tools/list → 实际读取；可写项目会话实际保存配置，界面服务再回读；只读发现仅有读取与宿主探针工具 | 同一服务测试实际启动 `mcp-server.mjs` 子进程，未模拟工具结果 |
| 类型检查 | 本目录严格检查 0 个诊断；导入的仓库代码另有 23 个诊断，未声称整个仓库检查通过 | `scripts/typecheck.mjs` |
| APK | Android SDK 35、AGP 8.9.3、Gradle 8.11.1 assembleDebug 成功；核验 APK 中压缩运行包与构建输入逐字节一致、页面入口资源齐全、没有积累旧哈希资源、包含第三方许可 | `scripts/verify-apk.mjs` |
| 真机加载 | OPPO Reno12 Pro / Android 16，已安装修正版 APK；显示两个工作台，360 × 764 CSS 像素下页面宽度没有溢出 | `scripts/inspect-phone.mjs`，`test-results/phone/current.png` |
| 真机环境 | APK 经 Termux 官方 RUN_COMMAND 接口启动已内置的本地业务脚本；UI 进入项目列表；通过手机 loopback 服务实际查询返回项目数组 | 手机私有目录已有 runtime、项目目录、任务状态；`phone-rpc.mjs query` 实际响应 |
| 真机编辑 | 实际触摸创建两类项目；CodeMirror 编辑保存、重新打开回读；Java 编辑器中保存真实物品注册代码；360px 深浅主题、原生键盘弹出后的保存/返回位置均已检查实际截图 | `test-phone.mjs mod/item/visual`；`test-results/phone/verification-*.json` 与 `final-editor-*.png` |
| 真机构建 | APK 发起已有缓存的 Gradle `--offline` 构建，模板项目 16.558 秒；加入真实 Minecraft 物品代码与模型后 14.997 秒再次成功；没有借电脑编译模组 | `verification-artifacts.json`；手机本地任务日志与生成 JAR |
| 真机产物 | MediaStore 导出 JAR 到下载目录；SHA-256 与手机业务服务产物一致；物品 JAR 包含重映射后的 `net/minecraft/class_*` 引用及模型文件 | `verify-phone-artifacts.mjs`，`test-results/phone/item-mod.jar` |
| 真机整合包 | 系统文件选择器导入刚编好的 JAR；确认后移出、再次通过系统选择器导入；导出 mrpack 并解包核验，确有配置与同一份 JAR | `test-phone.mjs pack/remove/export`；`verification-artifacts.json` |
| 真机 MCP | stdio 服务本身在手机 Node 内运行；实际发现工具、写入与回读真实文件、拒绝跨项目、只读会话仅暴露读取与探针工具 | `test-phone-mcp.mjs`；`verification-mcp.json` |
| 电脑运行边界 | 移除电脑 19085 业务转发端口后，仍通过 APK 页面打开并回读已保存文件；随后移除 CDP 调试转发端口 | `test-phone.mjs local`；`verification-local.json` |

修复过一个仅在打包后出现的问题：AAPT 会处理 `.gz` 资源，原文件名不可再直接读取。运行包现在以 `runtime.bin` 保留 gzip 原始字节，并新增打包完整性校验，防止只测源码而漏掉安装包问题。

## 排查和修复

早期新建请求、ADB 普通 echo 和 loopback 请求出现超时、offline。尝试 ADB 37.0.1、官方兼容 USB 后端和 36.0.2 后仍有中断，不能直接归因于数据线。

用户手动把 Termux 放到前台后，挂起请求恢复；不打开页面自动化、仅切换 ModMind 到前台，本地 health 仍曾超时。允许 Termux 后台活动后，连续约 35 秒的 ADB/health 检查及后续完整编辑、构建、导出流程持续通过，未再复现此前中断。该结果支持后台限制是影响因素，不声称已经确定所有系统机制。测试连接同时改为直接 CDP 与异步 ADB，截图先写手机临时文件再 pull，避免同步截图阻塞测试进程。

真机发现并修复：根目录空路径被文件读取规则误拒绝；保存成功提示遮挡返回操作；深色代码高亮对比度不足；原生状态栏背景未跟随主题；JAR 误导入后缺少移出入口。补上根目录服务测试、移出/重导入测试和实际画面复查。APK 资源采用当次打包清单，避免旧哈希资源积累。

测试临时启用的「插电保持亮屏」已恢复原值 `0`。Termux 后台活动设置由用户按本机运行需要开启并保留。

## 未验证与未迁移

- 取消、20 分钟超时、锁屏长任务、低内存回收及重启后的恢复尚未完成真机专项验证。
- 中文文本通过自动化输入和保存验证；没有完成人工拼音组合、手写等所有输入法场景验证。
- 没有做物理拔掉 USB 后长时间连续操作。已验证关闭电脑业务转发仍能编辑读取，生产路径只访问手机 loopback。
- 新设备首次启动且完全断网的降级表现；当前设备已准备 Termux/JDK/Node 与 Gradle 缓存，不可作为首次离线证据。
- 未启动 Minecraft，编译和重映射成功不等于物品游戏内效果通过。
- 未迁移手机 AI 对话、模型配置、其他工作台、Forge/NeoForge 等加载器或游戏启动器。
- Node/JDK/Gradle 仍在独立 Termux 中，免 Termux 的原生内置环境没有实现。

此前独立的 Android 工具链探针提供了基础缓存；上表另列的 APK 操作、构建和 MCP 是本次实际端到端验证，没有用旧探针代替。

## 本次 APK

- 开发调试包：`android/app/build/outputs/apk/debug/app-debug.apk`
- 体积：3,953,559 字节，已安装到测试手机。
- SHA-256：`d08145bed152aa66f5023231d8231f3fa6038946230d344186f2c343dcc9f338`
- 运行脚本包：337,015 字节（已随 APK 内置）。
- Node.js、JDK、Gradle 完整工具链仍由 Termux 承载；免 Termux 的内置原生运行层尚未实现。

测试源码与本记录可提交；设备标识、运行令牌、APK、设备截图和临时项目都放在忽略的生成目录，不作为仓库源码提交。
