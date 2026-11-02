# 手机设置、模型选择与成品分享（2026-11-02）

范围：延续 MIG-002/003/030，优化独立安卓设置/模型选择，并接入用户追加的成品原生分享。主导航仍只有工作台与灵感台；不表示桌面全部设置迁完。

本轮依据仓库设计规范、[apple-design](../.agents/skills/apple-design/SKILL.md) 和既有 emil-design-eng。采用单层导航、分组行、平台字体、即时触控反馈、滚动位置保留、按需展开，沿用ModMind语义配色。纯设置列表不增加装饰性手势或大面积玻璃材质。

| Before | After | Why |
| --- | --- | --- |
| 同层级长设置列表，子页第二层顶栏 | 单层导航、账号概览、分组入口 | 明确位置和返回路径 |
| 原生模型大下拉框 | 复用桌面家族、搜索、介绍、推荐、免费标识及线路记忆 | 能检索和比较，同模型合并线路 |
| 仅刷新当前目录 | 显式扫描复用ProviderSyncService.discoverModels | 沿用供应商/组遍历、原线路恢复和发现缓存 |
| 文件名作为下载入口 | 成品文件信息＋导出/分享 | 在结果处保存或交给其他手机应用 |

复用现有ModelCatalogRows、模型元数据、React/lucide及8张WebP（约1.6 MiB，固定图片空间），没有新增组件库或重写领域逻辑。

扫描由用户启动：ModMind账号走桌面完整发现，自定义API读取/models，不逐个发推理请求。任务独立于请求和页面，离开设置不打断恢复；重复启动返回同一任务，扫描中禁止账号变更及AI发送。失败保留旧目录并可重试。修复了快速完成时漏刷新目录的问题。未确认恢复时沿用桌面恢复日志/停用限制；断电、强杀完整时序矩阵未穷尽。MCP不能扫描或更改账号。

构建、整合包和归档的对话结果/构建记录共用ArtifactResult。导出沿用MediaStore到“下载/ModMind”；分享用ACTION_SEND、系统chooser与已有AndroidX Core FileProvider，只授予单个成品只读URI，直接引用已有不可变产物，避免大包额外复制。元数据分支复用workspace.artifactFile的ID、项目、路径校验，不返回原生绝对路径；原生检查文件名称、规范路径和大小。Provider不公开，未开放整个files/或申请所有文件权限。

回执只表示打开系统分享，不表示联系人收到。目标应用负责最终发送，MCP没有外部自动发送工具。原生机制依据[Android Sharesheet](https://developer.android.com/training/sharing/send)和[FileProvider](https://developer.android.com/reference/androidx/core/content/FileProvider)，没有社交SDK或云端中转。

验证：

- 桌面共用ProviderSync/ModelCatalogRows：2文件99项通过。
- 手机服务48项通过，含元数据同源信息与跨项目拒绝2项；设置/MCP7组通过。
- 设置浏览器7组、模型浏览器6组通过：快速完成、失败重试、离开页面、重复扫描、MCP拒绝、300模型、320/360/540px、深浅主题与减少动态效果。
- 移动源码类型诊断0；桌面既存外部诊断3，不称全仓通过。
- OPPO设置/模型真机5组通过，真实账号扫描51个可用模型，三处模型偏好/绑定完全保留。证据test-results/settings-refresh/result.json、scan.json；验证包0.6.0-pilot.6。
- 最终0.6.1-pilot.7成品真机5组通过：真实JAR导出哈希一致，拒绝路径穿越，原生分享找到微信和QQ，取消回到同一卡片。OPPO入口在分页后的“更多→全部应用或操作”，已实际查看两者；没有点击联系人或发送。
- 演示采用已有“独立环境测试”项目的真实编译JAR和明确命名的本地UI验证会话，不调用收费AI/生图，不伪造游戏画面；游戏运行未验证。证据test-results/artifact-share/result.json、finished-card.png、native-targets截图。
- 最终APK 284174450 bytes，SHA-256 c346721aeba49352104401f9080c7ce3fa1ff941c69e1bdd6527b13845641e1f；36资源/86原生组件核对，ADB安装成功，360×764无横向溢出、页面错误0。

自动验收曾因系统分享分页、应用不在前台和点击时序失败，调整脚本后才记录最终通过；失败尝试不计入通过数。未改手机分享排序偏好。尚未对每种格式/第三方客户端版本都实际发送，不能把系统面板出现目标当作联系人收件证明。
