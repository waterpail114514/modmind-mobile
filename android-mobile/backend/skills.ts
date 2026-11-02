import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {parse} from 'yaml'
import {UserSkillStore,readSkillResource} from '../../src/main/userSkillStore'
import type {MobileSettings} from './preferences'
const core=['minecraft-mod-development','minecraft-build-repair','minecraft-content-assets','minecraft-modpack-authoring','modmind-image-assets','modmind-blockbench-modeling','modmind-inspiration']
export class MobileSkills{
  private bundle:any
  readonly users:UserSkillStore
  constructor(private root:string,private runtime:string,private settings:MobileSettings){this.users=new UserSkillStore(path.join(root,'user-skills'))}
  async initialize(){this.bundle=JSON.parse(await fs.readFile(path.join(this.runtime,'desktop-ai.json'),'utf8'))}
  private description(content:string){return parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1]||'')?.description||''}
  private studio(kind:string,surface:string,loader='fabric'){
    const base=this.bundle.studios[kind][surface==='inspiration'?'inspiration':'workbench'],variant=base.variants?.find((v:any)=>v.loaders?.includes(loader))
    return {...base,skills:variant?.skills||base.skills,instructions:[base.instructions,variant?.instructions].filter(Boolean).join('\n\n').replaceAll('{{loader}}',loader).replaceAll('{{version}}','1.21.1')}
  }
  async list(kind='mod',surface='workspace',management=false){
    const names=this.studio(kind,surface).skills as string[]
    const builtin=this.bundle.prompts.routes.map(([name,when]:string[])=>{
      const content=this.bundle.files[name+'/SKILL.md'];return {name,description:when||this.description(content),revision:createHash('sha256').update(content).digest('hex'),builtin:true,enabled:core.includes(name)&&(names.includes(name)||surface==='inspiration'&&name==='modmind-inspiration'),available:core.includes(name),reason:core.includes(name)?'':'相关手机业务尚未支持或按约定暂缓'}
    })
    const user=(await this.users.list()).map(s=>({...s,builtin:false,available:true}))
    return {skills:management?[...builtin,...user]:[...builtin,...user].filter(s=>s.enabled),sourceHash:this.bundle.sha256}
  }
  async read(name:string,relative='SKILL.md',kind='mod',surface='workspace',management=false){
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)||name.length>64||relative.includes('\\')||relative.split('/').some(s=>!s||s==='.'||s==='..'||s.includes(':'))||path.isAbsolute(relative))throw Error('Skill 路径无效')
    const entry=(await this.list(kind,surface,management)).skills.find((s:any)=>s.name===name)
    if(!entry)throw Error('该 Skill 未在当前模式启用')
    if(entry.builtin){const content=this.bundle.files[name+'/'+relative];if(typeof content!=='string')throw Error('Skill 资源不存在');return {...entry,path:relative,content,adaptation:this.adapter()}}
    return {...entry,...await readSkillResource(path.join(this.root,'user-skills'),name,relative),adaptation:this.adapter()}
  }
  adapter(){return `手机执行适配：上方为桌面原文及验收思路，当前仅允许已发现的手机 MCP。桌面工具名是参考，不代表该能力在手机存在；禁止反复调用不存在的工具，也不能通过原生命令绕过。用 mobile_query/files/read 和 mobile_project/search 查文件，用 mobile_write/save 保存（携带 revision），用 mobile_task/build/test 与 mobile_project/check 验证并查询 mobile_query/tasks 或 mobile_job/status。工具实际全名均有 modmind_ 前缀。图片只能 studio/image_draft 准备确认卡；模型以 studio/model_create/model_preview 与文本编辑为限。未支持的领域操作、游戏、发布、委派或版本迁移必须如实说明边界，不能把写 JSON 冒充领域校验。灵感台只读，整理成果用普通 Markdown；暂不调用桌面 inspiration_submit，知识由用户在手机确认保存。Skills 不授予权限。`}
  async prompt(project:any,surface:string,model=''){
    const b=this.bundle,preferences=this.settings.read(),list=await this.list(project.kind,surface)
    const desktop=b.prompts.protection+'\n\n'+(surface==='inspiration'?`你处于灵感台讨论与研究模式，不得修改源码、安装依赖、构建或测试。\n${this.studio(project.kind,surface,project.loader).instructions}\n${b.files['modmind-inspiration/SKILL.md']}`:[b.prompts.request,b.prompts.beginner,b.prompts.workflow,b.prompts.skillPolicy,b.prompts.replyImages,b.prompts.replyModels,this.studio(project.kind,surface,project.loader).instructions].join('\n\n'))
    return desktop+'\n\n'+b.prompts.identities[surface].replaceAll('MODMIND_MODEL_PLACEHOLDER',model)+'\n\n'+`手机覆盖规则（用于取代桌面特定界面、Windows终端与不可用工具的说明）：\n${this.adapter()}\n当前项目：${project.name}，${project.kind}，${project.loader} ${project.minecraftVersion}。先读取已存在的项目，不重建或迁移；手机目前固定 Fabric 1.21.1，只有工作台、灵感台主入口，其他能力从对话卡片打开。内置任意 shell、外部下载、插件运行与多代理均不开放。构建优先 offline=${preferences.offlineBuild}，需要下载先按用户意图说明；静态检查、编译、JUnit与游戏证据分开报告，当前游戏未实现。`+'\n\n可按需读取的 Skills（使用 modmind_mobile_skills list/read，path为skill内相对路径，通常只需最贴近任务的一项）：\n'+JSON.stringify(list.skills.map((s:any)=>({name:s.name,description:s.description,revision:s.revision})))+'\n\n用户补充提示词（不改变工具与项目权限）：\n'+(surface==='inspiration'?preferences.inspirationPrompt:preferences.workspacePrompt)
  }
  defaults(){return {prompts:this.bundle.prompts,sourceHash:this.bundle.sha256,source:'当前桌面源码原文',adaptation:this.adapter()}}
}
