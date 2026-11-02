export interface MobilePreferences {
  theme:'system'|'light'|'dark';themePreset:string;fontScale:number;customThemeColors:Record<string,any>
  reasoningExpanded:boolean;notificationsEnabled:boolean;allowLongerContext:boolean
  approvalMode:'managed'|'manual';offlineBuild:boolean;buildMemoryMb:number;gradleDownloadSource:'auto'|'china'|'official';networkProxyUrl:string
  workspacePrompt:string;inspirationPrompt:string
}
export const defaultMobilePreferences:MobilePreferences={theme:'system',themePreset:'modmind',fontScale:100,customThemeColors:{},reasoningExpanded:false,notificationsEnabled:false,allowLongerContext:false,approvalMode:'managed',offlineBuild:true,buildMemoryMb:1024,gradleDownloadSource:'auto',networkProxyUrl:'',workspacePrompt:'',inspirationPrompt:''}
export const mobileSettingBoundaries=[
 ['侧栏布局','手机只有工作台和灵感台，入口通过项目菜单与设置收纳'],
 ['窗口关闭、托盘','由 Android 返回键、最近任务和本地环境通知管理'],
 ['自定义背景图片与视频','暂未接手机媒体背景，主题与自定义颜色可用'],
 ['远程构建、Gitee Go','当前使用手机本地环境，没有配置云端构建'],
 ['外部 Agent 与外部 MCP 客户端','使用内置 Codex 和应用内 MCP，未开放外部客户端接入'],
 ['功能插件安装与卸载','手机领域能力随应用发布，桌面插件运行框架尚未迁移'],
 ['Java 路径与 Gradle 可执行文件','使用应用内置 JDK 21 与项目 Wrapper，不能使用电脑路径'],
 ['贡献上传','手机暂无自动上传通道'],
 ['更新与重装','当前为独立试验包，通过 Android 安装器更新'],
 ['Git、声音、更多版本','按当前约定暂缓']
] as const
