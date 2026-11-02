// Deliberately copies portable preferences only, never credentials or desktop paths.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(process.env.APPDATA,'modmind'),output=path.join(root,'test-results/desktop-sync');await fs.mkdir(output,{recursive:true})
const raw=await fs.readFile(path.join(desktop,'settings.json'),'utf8').then(JSON.parse)
const patch={theme:raw.darkMode?'dark':'light',themePreset:raw.themePreset||'modmind',fontScale:raw.fontScale||100,customThemeColors:raw.customThemeColors||{},allowLongerContext:raw.allowLongerContext===true,approvalMode:raw.codexApprovalMode==='manual'?'manual':'managed'}
const userRoot=path.join(desktop,'workbench-skills'),entries=await fs.readdir(userRoot,{withFileTypes:true}).catch(()=>[])
const skills=[];for(const entry of entries)if(entry.isDirectory()){const content=await fs.readFile(path.join(userRoot,entry.name,'SKILL.md'),'utf8');skills.push({name:entry.name,content})}
const report={portableKeys:Object.keys(patch),userSkills:skills.length,omitted:['电脑API密钥/登录授权','电脑Java、Gradle、外部Agent路径','电脑本机代理地址','托盘/窗口与侧栏布局','未适配的桌面功能插件、媒体背景、远程配置','通知开启由Android系统权限与用户设置决定'],sourceSettingsHash:createHash('sha256').update(JSON.stringify(patch)).digest('hex'),applied:false}
if(process.argv.includes('--apply')){
 process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087';const{phoneRpc}=await import('./phone-rpc.mjs')
 const current=await phoneRpc('settings',{operation:'read'});await phoneRpc('settings',{operation:'save',patch,revision:current.revision})
 for(const skill of skills){const existing=(await phoneRpc('skills',{operation:'list'})).skills.find(s=>s.name===skill.name);if(!existing)await phoneRpc('skills',{operation:'save',content:skill.content})}
 const actual=await phoneRpc('settings',{operation:'read'});for(const[key,value]of Object.entries(patch))if(JSON.stringify(actual[key])!==JSON.stringify(value))throw Error('Preference did not persist: '+key)
 report.applied=true
}
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({applied:report.applied,portableKeys:report.portableKeys,userSkillCount:report.userSkills}))
