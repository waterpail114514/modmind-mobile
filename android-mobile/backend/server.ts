import http from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import Ajv from 'ajv'
import { MobileWorkspace, WorkspaceError } from './workspace'
import { MobileAccount } from './account'
import { MobileAi } from './ai'
import { MobileAssets } from './assets'
import {MobileProjectFiles} from './projectFiles'
import {MobileJobs} from './jobs'
import {MobileVerification} from './verification'
import {MobileSettings} from './preferences'
import {MobileSkills} from './skills'
import {MobileApprovals} from './approvals'
import {mobileSettingBoundaries} from '../shared/settings'
import {mobileActivityLabel} from '../shared/activity'
export { MobileAssets } from './assets'
export { MobileAi, MobileWorkspace }

export const MOBILE_VERSION = '1.0.0-preview.1'
interface Context { projectId?: string; readOnly: boolean; ui?: boolean; checkpoint?:boolean;signal?:AbortSignal }
const projectId = { type: 'string', pattern: '^[a-f0-9-]{36}$' }
const operationSchema = (operations: Record<string, Record<string, object>>, required: Record<string, string[]> = {}) => {
  const variants: Record<string, object[]> = {}
  for (const fields of Object.values(operations)) for (const [name, schema] of Object.entries(fields)) (variants[name] ||= []).push(schema)
  return {
    type: 'object', additionalProperties: false, required: ['operation'],
    properties: { operation: { enum: Object.keys(operations) }, projectId, ...Object.fromEntries(Object.entries(variants).map(([name, schemas]) => [name, schemas.length > 1 ? { anyOf: schemas } : schemas[0]])) },
    allOf: Object.keys(operations).map(operation => ({ if: { properties: { operation: { const: operation } } }, then: { properties: { operation: { const: operation }, projectId, ...operations[operation] }, additionalProperties: false, required: required[operation] || [] } }))
  }
}
const relative = { type: 'string', minLength: 1, maxLength: 512 }
const schemas: Record<string, any> = {
  query: operationSchema({ projects: {}, project: {}, files: { path: { type: 'string', maxLength: 512 }, offset: { type: 'integer', minimum: 0, maximum: 100000 } }, read: { path: relative }, pack: {}, tasks: {} }, { read: ['path'] }),
  write: operationSchema({ save: { path: relative, content: { type: 'string', maxLength: 262144 }, revision: { type: ['string', 'null'], maxLength: 64 } }, restore: { path: relative, revision: { type: ['string', 'null'], maxLength: 64 } }, export: {}, remove_mod: { fileName: { type: 'string', minLength: 5, maxLength: 180 } } }, { save: ['path', 'content', 'revision'], restore: ['path', 'revision'], remove_mod: ['fileName'] }),
  task: operationSchema({ build: { offline: { type: 'boolean' } }, test:{offline:{type:'boolean'}},check:{}, cancel: { taskId: projectId } }, { cancel: ['taskId'] }),
  create: { type: 'object', additionalProperties: false, required: ['name', 'namespace', 'kind'], properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, namespace: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,47}$' }, kind: { enum: ['mod', 'modpack'] } } },
  session: { type: 'object', additionalProperties: false, required: ['projectId', 'readOnly'], properties: { projectId, readOnly: { type: 'boolean' } } }
}
schemas.project=operationSchema({
  import_preview:{ticket:projectId},import_start:{ticket:projectId,name:{type:'string',minLength:1,maxLength:100}},import_discard:{ticket:projectId},
  scan:{},check:{},archive:{},snapshots:{},snapshot:{label:{type:'string',maxLength:80}},restore_snapshot:{snapshotId:projectId,confirmed:{const:true}},remove_snapshot:{snapshotId:projectId,confirmed:{const:true}},
  search:{query:{type:'string',minLength:1,maxLength:200},content:{type:'boolean'}},move:{path:relative,to:relative,revision:{type:'string',pattern:'^[a-f0-9]{64}$'}},remove_file:{path:relative,revision:{type:'string',pattern:'^[a-f0-9]{64}$'},confirmed:{const:true}},
  rename:{name:{type:'string',minLength:1,maxLength:100}},delete:{confirmed:{const:true}},recovery_settings:{automatic:{type:'boolean'}}
},{import_preview:['ticket'],import_start:['ticket'],import_discard:['ticket'],restore_snapshot:['snapshotId','confirmed'],remove_snapshot:['snapshotId','confirmed'],search:['query'],move:['path','to','revision'],remove_file:['path','revision','confirmed'],rename:['name'],delete:['confirmed'],recovery_settings:['automatic']})
schemas.job=operationSchema({list:{},status:{jobId:projectId},cancel:{jobId:projectId}},{status:['jobId'],cancel:['jobId']})
const text = { type: 'string', maxLength: 20000 }
const selectionScope={enum:['settings','workspace','inspiration']}
const idText = { type: 'string', minLength: 1, maxLength: 128 }
Object.assign(schemas, {
  account: operationSchema({ reset:{scope:{enum:['workspace','inspiration']}},preferences:{scope:selectionScope,model:idText,reasoningLevel:{enum:['auto','none','minimal','low','medium','high','xhigh','max','ultra']},fastMode:{type:'boolean'},modelContextWindows:{type:'object',maxProperties:500,additionalProperties:{type:'integer',minimum:1024,maximum:100000000}},modelAutoCompactTokenLimits:{type:'object',maxProperties:500,additionalProperties:{type:'integer',minimum:1024,maximum:100000000}},reasoningEffortOptions:{type:'object',maxProperties:500,additionalProperties:{type:'array',minItems:1,maxItems:5,uniqueItems:true,items:{enum:['none','minimal','low','medium','high','xhigh','max','ultra']}}}},status: {scope:selectionScope}, discover: {}, begin: {}, poll: {}, usage: {}, catalog: { refresh: { type: 'boolean' } }, logout: {}, configure: { baseUrl: { type: 'string', maxLength: 2048 }, apiKey: { type: 'string', maxLength: 4096 }, model: idText }, select: {scope:selectionScope, model: idText, account: idText, billing: { enum: ['free','quota'] }, group: idText } }, {reset:['scope'],configure: ['baseUrl','apiKey','model'], select: ['model'] }),
  ai: operationSchema({ list: { surface: { enum: ['workspace','inspiration'] } }, create: { surface: { enum: ['workspace','inspiration'] } }, read: { conversationId: idText, afterSequence: { type: 'integer', minimum: 0 } }, send: { conversationId: idText, content: { type:'string',minLength:1,maxLength:20000 } }, cancel: { conversationId: idText }, notes: {}, note_save: { noteId: idText, title: { type:'string',maxLength:120 }, content: text, remove: {type:'boolean'} } }, { list:['surface'],create:['surface'],read:['conversationId'],send:['conversationId','content'],cancel:['conversationId'] }),
  images: operationSchema({ list: {}, provider: {}, status:{requestId:projectId}, read: { imageId: projectId }, remove:{imageId:projectId}, generate: { prompt: {type:'string',minLength:1,maxLength:20000},requestId:projectId }, cancel:{}, apply: { imageId: projectId, path: relative } }, {status:['requestId'],read:['imageId'],remove:['imageId'],generate:['prompt'],apply:['imageId','path']}),
  models: operationSchema({ list:{},create:{path:relative},read:{path:relative},preview:{path:relative} }, {create:['path'],read:['path'],preview:['path']})
})
// Share the same business routes with MCP without exposing account credentials or starting nested AI runs.
const studioSchema = operationSchema({ notes:{}, models:{}, model_preview:{path:relative}, image_draft:{prompt:{type:'string',minLength:1,maxLength:20000},title:{type:'string',maxLength:120}},images:{}, image:{imageId:projectId}, note_save:{ noteId:idText,title:{type:'string',maxLength:120},content:text,remove:{type:'boolean'} },model_create:{path:relative},image_apply:{imageId:projectId,path:relative} }, {image_draft:['prompt'],model_preview:['path'],image:['imageId'],model_create:['path'],image_apply:['imageId','path']})
Object.assign(schemas,{studio:studioSchema})
schemas.settings=operationSchema({read:{},save:{patch:{type:'object'},revision:{type:'string',pattern:'^[a-f0-9]{64}$'}},defaults:{},diagnostics:{},storage:{},clear_cache:{target:{enum:['gradle','exports','transfers']},confirmed:{const:true}},approvals:{},decide:{id:projectId,allow:{type:'boolean'}}},{save:['patch','revision'],clear_cache:['target','confirmed'],decide:['id','allow']})
schemas.skills=operationSchema({list:{kind:{enum:['mod','modpack']},surface:{enum:['workspace','inspiration']}},read:{name:idText,path:relative,kind:{enum:['mod','modpack']},surface:{enum:['workspace','inspiration']}},save:{name:idText,content:{type:'string',maxLength:262144},revision:idText},enable:{name:idText,enabled:{type:'boolean'}},remove:{name:idText,revision:idText}},{read:['name'],save:['content'],enable:['name','enabled'],remove:['name','revision']})
export const mobileTools = [
  { name: 'modmind_mobile_query', description: '查询绑定的安卓项目、文件、源码、整合包清单和构建任务；仅限当前会话项目。文件按目录分页，源码有容量限制。', inputSchema: schemas.query, permission: 'read' },
  { name: 'modmind_mobile_write', description: '保存或恢复绑定项目的文本文件、移出已导入模组，或导出标准 mrpack。保存与恢复必须携带读取所得 revision；冲突保留草稿。移出不删除原始导入来源，可重新导入。只读会话禁止。', inputSchema: schemas.write, permission: 'write' },
  { name: 'modmind_mobile_task', description: '在安卓手机本机构建绑定的 Fabric 1.21.1 模组，或取消该项目任务。返回任务引用，必须用 query/tasks 检查完成状态和产物。一次只运行一个构建。只读会话禁止。', inputSchema: schemas.task, permission: 'process' }
]
mobileTools.push({name:'modmind_mobile_studio',description:'查询项目知识、3D 模型和图片。model_preview 返回可打开的模型卡片，image 返回图片。用户要求生成图片时必须调用 image_draft（prompt），它只准备描述并在对话内显示生成确认卡，不扣额度；不能凭空声称已生图。写入 note_save、model_create、image_apply 仅工作台可用。',inputSchema:studioSchema as any,permission:'read'})
mobileTools.push({name:'modmind_mobile_project',description:'查询当前项目归档体积、搜索文件或内容、管理轻量恢复点、移动或删除已读取的文本文件。archive/snapshot/restore_snapshot 返回后台操作 id，请用 job/status 查询；恢复只覆盖恢复点中的可编辑文件，模组 JAR 等二进制保留。危险操作必须有用户确认 confirmed=true。项目导入、删除项目与恢复设置只能由安卓界面执行。',inputSchema:schemas.project,permission:'read'})
mobileTools.push({name:'modmind_mobile_job',description:'查询或取消当前项目已提交的后台操作，状态 completed 才表示完成。',inputSchema:schemas.job,permission:'read'})
mobileTools.push({name:'modmind_mobile_skills',description:'按当前制作模式与会话权限列出或按需读取桌面同步的领域 Skills 和用户启用 Skills。list后选择最贴近当前任务的一项read，path为Skill内相对路径；内容是指导，不扩大权限，手机适配优先于原文中的桌面工具和界面路径。',inputSchema:operationSchema({list:{},read:{name:idText,path:relative}},{read:['name']}),permission:'read'})
const ajv = new Ajv({ strict: false, allErrors: true })
const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, ajv.compile<Record<string, any>>(schema)]))
const tokenEquals = (a: string, b: string) => /^[a-f0-9]{64}$/.test(a) && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const deny = (code: string, message: string): never => { throw new WorkspaceError(code, message) }

export async function startMobileServer(options: { root: string; runtime: string; gradleHome: string; token: string; port?: number; javaHome?: string }) {
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error('本地连接令牌无效')
  const workspace = new MobileWorkspace(options); await workspace.initialize()
  const projectFiles=new MobileProjectFiles(workspace);await projectFiles.initialize()
  const jobs=new MobileJobs(options.root);await jobs.initialize()
  const verification=new MobileVerification(workspace,projectFiles)
  let ai: MobileAi, assets: MobileAssets
  const settings=new MobileSettings(options.root,()=>Boolean(ai?.busy||assets?.busy||jobs.busy||workspace.busy));await settings.initialize();workspace.buildPreferences=()=>settings.read()
  const skills=new MobileSkills(options.root,options.runtime,settings);await skills.initialize()
  const approvals=new MobileApprovals()
  const account = new MobileAccount(options.root, () => Boolean(ai?.busy || assets?.busy)); await account.initialize()
  ai = new MobileAi(workspace, account, (projectId, readOnly) => dispatch('session',{projectId,readOnly},{ui:true,readOnly:false}),{settings,skills})
  assets = new MobileAssets(workspace, account)
  const sessions = new Map<string, Context & { expiresAt: number }>()
  const sessionFile = path.join(options.root, 'sessions.json')
  const saved = await fs.readFile(sessionFile, 'utf8').then(JSON.parse).catch(() => [])
  for (const entry of saved.slice(-32)) if (entry.expiresAt > Date.now()) sessions.set(entry.token, entry)
  async function context(request: http.IncomingMessage): Promise<Context> {
    const token = String(request.headers['x-modmind-token'] || '')
    if (tokenEquals(token, options.token)) return { ui: true, readOnly: false }
    const session = sessions.get(token)
    if (session && session.expiresAt > Date.now()) return session
    return deny('AUTH', '本地连接未授权，请重新连接')
  }
  async function dispatch(action: string, input: any, ctx: Context): Promise<any> {
    if (!validators[action]) return deny('ACTION', '安卓试验版尚未迁移此能力')
    if (!validators[action](input)) return deny('VALIDATION', '参数格式不正确：' + ajv.errorsText(validators[action].errors))
    if(action==='settings'){
      if(!ctx.ui)return deny('PERMISSION','设置仅可在手机界面修改')
      if(input.operation==='read')return {...settings.read(),boundaries:mobileSettingBoundaries}
      if(input.operation==='save')return settings.save(input.patch,input.revision)
      if(input.operation==='defaults')return skills.defaults()
      if(input.operation==='diagnostics'){
        const folder=path.join(options.root,'diagnostics');await fs.mkdir(folder,{recursive:true});const file=path.join(folder,'modmind-android-diagnostics.json')
        await fs.writeFile(file,JSON.stringify({version:MOBILE_VERSION,node:process.version,platform:process.platform,architecture:process.arch,desktopAiHash:skills.defaults().sourceHash,toolNames:mobileTools.map(t=>t.name),createdAt:new Date().toISOString(),preferences:{theme:settings.read().theme,approvalMode:settings.read().approvalMode,offlineBuild:settings.read().offlineBuild,buildMemoryMb:settings.read().buildMemoryMb},accountConnected:account.status().connected},null,2))
        return workspace.artifact('application',file,true)
      }
      if(input.operation==='approvals')return {pending:approvals.list()}
      if(input.operation==='decide')return approvals.decide(input.id,input.allow)
      const roots={gradle:options.gradleHome,exports:workspace.artifactsRoot,transfers:path.join(options.root,'transfers')}
      const usage=async(folder:string):Promise<number>=>{let bytes=0;for(const entry of await fs.readdir(folder,{withFileTypes:true}).catch(()=>[])){const file=path.join(folder,entry.name);if(entry.isDirectory())bytes+=await usage(file);else if(entry.isFile())bytes+=(await fs.stat(file)).size}return bytes}
      if(input.operation==='storage')return {entries:await Promise.all(Object.entries(roots).map(async([id,folder])=>({id,bytes:await usage(folder)})))}
      if(ai.busy||assets.busy||jobs.busy||workspace.busy)return deny('TASK_BUSY','请先结束当前任务再清理')
      const folder=roots[input.target as keyof typeof roots],real=path.resolve(folder),owner=path.resolve(options.root)+path.sep
      if(!real.startsWith(owner))return deny('PATH','缓存位置不属于应用')
      await fs.rm(real,{recursive:true,force:true});await fs.mkdir(real,{recursive:true});return {cleared:true,target:input.target}
    }
    if(action==='skills'){
      const project=ctx.projectId?await workspace.project(ctx.projectId):undefined,kind=project?.kind||input.kind||'mod',surface=ctx.ui?input.surface||'workspace':ctx.readOnly?'inspiration':'workspace'
      if(input.operation==='list')return skills.list(kind,surface,Boolean(ctx.ui))
      if(input.operation==='read')return skills.read(input.name,input.path,kind,surface,Boolean(ctx.ui))
      if(!ctx.ui)return deny('PERMISSION','仅用户可以管理 Skills')
      if(ai.busy)return deny('TASK_BUSY','本轮AI结束后再修改Skills，避免执行中内容变化')
      if(input.operation==='save'){if(!input.name&&(await skills.users.list()).length>=64)throw Error('手机最多保留 64 个自定义 Skills，请先移除不需要的内容');return skills.users.save({name:input.name,content:input.content,revision:input.revision})}
      if(input.operation==='enable')return skills.users.setEnabled(input.name,input.enabled)
      await skills.users.remove(input.name,input.revision);return {removed:true}
    }
    if(!ctx.ui&&!ctx.readOnly&&settings.read().approvalMode==='manual'&&(action==='write'||action==='task'||action==='studio'&&['note_save','model_create','image_apply'].includes(input.operation)||action==='project'&&!['scan','snapshots','search','check'].includes(input.operation)))await approvals.request(ctx.projectId!,mobileActivityLabel(input.operation),input.path,ctx.signal)
    ctx.signal?.throwIfAborted()
    if(action==='job')return input.operation==='list'?{jobs:jobs.list(ctx.projectId||input.projectId)}:input.operation==='status'?jobs.read(input.jobId,ctx.projectId):ctx.readOnly?deny('READ_ONLY','只读会话不能取消操作'):jobs.cancel(input.jobId,ctx.projectId)
    if(action==='project'&&input.operation.startsWith('import_')){
      if(!ctx.ui)return deny('PERMISSION','请在安卓项目菜单导入完整项目')
      if(input.operation==='import_preview')return projectFiles.inspect(input.ticket)
      if(input.operation==='import_discard')return projectFiles.discard(input.ticket)
      return jobs.start('导入项目',undefined,(signal,phase)=>projectFiles.commit(input.ticket,input.name,signal,phase))
    }
    if(action==='project'&&ctx.readOnly&&!['scan','snapshots','search','check'].includes(input.operation))return deny('READ_ONLY','灵感台会话不能修改或归档项目')
    if (ctx.readOnly && ['write', 'task', 'create', 'session'].includes(action)) return deny('READ_ONLY', '当前会话只读，不能修改、导出或执行构建')
    if (ctx.projectId && input.projectId && ctx.projectId !== input.projectId) return deny('PROJECT_SCOPE', '不能操作其他项目')
    if (['account','ai','images','models'].includes(action) && !ctx.ui) return deny('PERMISSION','请通过工作台工具操作当前项目')
    if (action === 'account') {
      if(input.operation==='preferences')return account.preferences(input)
      if(input.operation==='status')return account.status(input.scope)
      if(input.operation==='reset')return account.reset(input.scope)
      if(input.operation==='begin')return account.begin()
      if(input.operation==='poll')return account.poll()
      if(input.operation==='usage')return account.usage()
      if(input.operation==='catalog')return account.catalog(input.refresh)
      if(input.operation==='discover')return account.discover()
      if(input.operation==='configure')return account.configure(input)
      if(input.operation==='select')return account.select(input)
      if(input.operation==='logout')return account.logout()
    }
    if (action === 'create') { if (!ctx.ui) return deny('PERMISSION', '请在安卓界面新建项目'); return workspace.create({name:input.name,namespace:input.namespace,kind:input.kind}) }
    if (action === 'session') {
      if (!ctx.ui) return deny('PERMISSION', '只有安卓应用可以授权工具会话')
      await workspace.project(input.projectId)
      const token = randomBytes(32).toString('hex'), expiresAt = Date.now() + 24 * 60 * 60 * 1000
      const entry = { token, projectId: input.projectId, readOnly: input.readOnly, expiresAt }
      for (const [key, value] of sessions) if (value.expiresAt <= Date.now()) sessions.delete(key)
      if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!)
      sessions.set(token, entry)
      await fs.writeFile(sessionFile, JSON.stringify([...sessions].map(([token, value]) => ({ token, ...value }))), { mode: 0o600 })
      for(const name of (await fs.readdir(options.root)).filter(name=>/^mcp-[a-f0-9]{16}\.json$/.test(name))) {
        const file=path.join(options.root,name), old=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null)
        if(!old||!sessions.has(old.token))await fs.rm(file,{force:true})
      }
      const configFile = path.join(options.root, 'mcp-' + randomBytes(8).toString('hex') + '.json')
      await fs.writeFile(configFile, JSON.stringify({ port: options.port || 19084, token, workspaceOnly: true, hasPluginTools: false, featurePluginAvailability: true, featurePluginTools: true, version: MOBILE_VERSION }), { mode: 0o600 })
      return { configFile, command: 'node', args: [path.join(options.runtime, 'mcp-server.mjs')], env: { MODMIND_BRIDGE_CONFIG: configFile }, readOnly: input.readOnly, expiresAt }
    }
    const id = ctx.projectId || input.projectId
    if (action === 'query' && input.operation === 'projects') return ctx.projectId ? { projects: [await workspace.project(ctx.projectId)] } : workspace.list()
    if (!id) return deny('PROJECT_REQUIRED', '请先选择项目')
    await workspace.project(id)
    if(action==='project'){
      if(input.operation==='check')return jobs.start('检查项目',id,(signal,phase)=>verification.inspect(id,signal,phase))
      if(input.operation==='scan'){const value=await projectFiles.scan(id);return {files:value.files.length,bytes:value.bytes,scope:'source',excludes:['构建缓存','游戏运行时','会话与账号']}}
      if(input.operation==='archive')return jobs.start('导出项目源码',id,(signal,phase)=>projectFiles.export(id,signal,phase))
      if(input.operation==='snapshots')return projectFiles.recoveryInfo(id)
      if(input.operation==='snapshot')return jobs.start('创建恢复点',id,signal=>projectFiles.snapshot(id,input.label||'恢复点',signal))
      if(input.operation==='restore_snapshot')return jobs.start('恢复编辑文件',id,signal=>projectFiles.restore(id,input.snapshotId,signal))
      if(input.operation==='remove_snapshot')return projectFiles.removeSnapshot(id,input.snapshotId)
      if(input.operation==='search')return projectFiles.search(id,input.query,input.content)
      if(input.operation==='move')return projectFiles.move(id,input.path,input.to,input.revision)
      if(input.operation==='remove_file')return projectFiles.removeFile(id,input.path,input.revision)
      if(input.operation==='rename')return workspace.rename(id,input.name)
      if(input.operation==='delete'){if(!ctx.ui)return deny('PERMISSION','请在安卓界面确认删除项目');if(ai.busy||assets.busy||jobs.busy)return deny('TASK_BUSY','请先结束当前操作');return workspace.delete(id)}
      if(input.operation==='recovery_settings'){if(!ctx.ui)return deny('PERMISSION','恢复设置仅可由用户修改');return projectFiles.setAutomatic(id,input.automatic)}
    }
    if(ctx.projectId&&!ctx.readOnly&&!ctx.checkpoint&&action==='write'&&['save','restore','remove_mod'].includes(input.operation)){
      await projectFiles.ensureAutomatic(id);ctx.checkpoint=true
    }
    if(action==='ai')return ai.operate({...input,projectId:id})
    if(action==='images')return assets.images({...input,projectId:id},Boolean(ctx.ui))
    if(action==='models')return assets.models({...input,projectId:id})
    if(action==='studio') {
      if(ctx.readOnly && ['note_save','model_create','image_apply'].includes(input.operation)) return deny('READ_ONLY','灵感台会话不能修改项目或笔记')
      const value={...input,projectId:id}
      if(input.operation==='image_draft')return {type:'image-request',prompt:input.prompt,...(input.title?{title:input.title}:{}),requiresConfirmation:true}
      if(input.operation==='notes'||input.operation==='note_save')return ai.operate(value)
      if(input.operation==='models'||input.operation==='model_preview'||input.operation==='model_create')return assets.models({...value,operation:input.operation==='models'?'list':input.operation==='model_preview'?'preview':'create'})
      return assets.images({...value,operation:input.operation==='images'?'list':input.operation==='image'?'read':'apply'},false)
    }
    if (action === 'query') {
      if (input.operation === 'project') return workspace.project(id)
      if (input.operation === 'files') return workspace.files(id, input.path, input.offset)
      if (input.operation === 'read') return workspace.read(id, input.path)
      if (input.operation === 'pack') return workspace.pack(id)
      if (input.operation === 'tasks') return workspace.taskList(id)
    }
    if (action === 'write') {
      if (input.operation === 'save') return workspace.save(id, {path:input.path,content:input.content,revision:input.revision})
      if (input.operation === 'restore') return workspace.restore(id, input.path, input.revision)
      if (input.operation === 'export') return workspace.exportPack(id)
      if (input.operation === 'remove_mod') return workspace.removeMod(id, input.fileName)
    }
    if (action === 'task') {
      if(input.operation==='check')return jobs.start('检查项目',id,(signal,phase)=>verification.inspect(id,signal,phase))
      if(input.operation==='test')return workspace.build(id,input.offline,'test')
      return input.operation === 'build' ? workspace.build(id, input.offline) : workspace.cancel(id, input.taskId)
    }
    return deny('ACTION', '未实现的操作')
  }
  const json = (response: http.ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body))
  }
  const body = async (request: http.IncomingMessage, max: number) => {
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of request) { size += chunk.length; if (size > max) deny('BODY_LIMIT', '文件或请求超过容量限制'); chunks.push(chunk) }
    return Buffer.concat(chunks)
  }
  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.origin) return deny('ORIGIN', '不接受网页跨域访问')
      const requestAbort=new AbortController();response.once('close',()=>{if(!response.writableEnded)requestAbort.abort(Error('调用已断开'))})
      const ctx = {...await context(request),signal:requestAbort.signal}, url = new URL(request.url || '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { version: MOBILE_VERSION, node: process.version, platform: process.platform, java: Boolean(process.env.PREFIX), connected: true })
      if (request.method === 'GET' && url.pathname.startsWith('/artifact/')) {
        const { artifact, file } = await workspace.artifactFile(url.pathname.slice('/artifact/'.length), ctx.projectId)
        if(url.searchParams.get('metadata')==='1')return json(response,200,artifact)
        response.writeHead(200, { 'Content-Type': artifact.name.endsWith('.mrpack') ? 'application/x-modrinth-modpack+zip' : artifact.name.endsWith('.zip')?'application/zip':artifact.name.endsWith('.json')?'application/json':'application/java-archive', 'Content-Length': artifact.size, 'X-Artifact-Name': artifact.name, 'Cache-Control': 'no-store' })
        createReadStream(file).on('error', () => response.destroy()).pipe(response); return
      }
      if (request.method === 'POST' && url.pathname === '/upload') {
        if (ctx.readOnly) return deny('READ_ONLY', '当前会话只读')
        const id = url.searchParams.get('projectId') || ''
        if (ctx.projectId && ctx.projectId !== id) return deny('PROJECT_SCOPE', '不能导入到其他项目')
        return json(response, 200, await workspace.importMod(id, url.searchParams.get('name') || '', await body(request, 64 * 1024 * 1024)))
      }
      if(request.method==='POST'&&url.pathname==='/import-project'){
        if(!ctx.ui)return deny('PERMISSION','完整项目导入只接受安卓界面请求')
        return json(response,200,await projectFiles.receive(request,url.searchParams.get('name')||'project.zip'))
      }
      if (request.method !== 'POST' || !['/rpc', '/tool'].includes(url.pathname)) return json(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
      const value = JSON.parse((await body(request, 1024 * 1024)).toString('utf8'))
      if (url.pathname === '/tool') {
        if (value.action === 'feature_plugin_availability') return json(response, 200, { tools: mobileTools.filter(tool => !ctx.readOnly || tool.permission === 'read'), ownedTools: mobileTools.map(tool => tool.name), imageStudio: false })
        if (value.action === 'mcp_probe') return json(response, 200, { ok:true, marker:'modmind-mcp-ready-v1', ready: true, platform: 'android', projectId: ctx.projectId, readOnly: ctx.readOnly, version: MOBILE_VERSION })
        if (value.action === 'project_info') return json(response, 200, ctx.projectId ? await workspace.project(ctx.projectId) : { projects: (await workspace.list()).projects })
        if (value.action !== 'feature_tool_call') return deny('ACTION', '工具尚未迁移到安卓')
        const action = { modmind_mobile_query: 'query', modmind_mobile_write: 'write', modmind_mobile_task: 'task',modmind_mobile_studio:'studio',modmind_mobile_project:'project',modmind_mobile_job:'job',modmind_mobile_skills:'skills' }[value.input?.tool as string]
        if (!action) return deny('ACTION', '未知的安卓工具')
        return json(response, 200, await dispatch(action, value.input.input || {}, ctx))
      }
      return json(response, 200, await dispatch(value.action, value.input || {}, ctx))
    } catch (error) {
      const failure = error as Error & { code?: string }
      const code = failure.code || 'FAILED'
      json(response, code === 'AUTH' ? 401 : ['READ_ONLY', 'PROJECT_SCOPE', 'PERMISSION', 'ORIGIN'].includes(code) ? 403 : code === 'CONFLICT' ? 409 : 400, { error: { code, message: failure.message } })
    }
  })
  server.requestTimeout = 120000; server.headersTimeout = 15000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port || 19084, '127.0.0.1', resolve) })
  return { server, workspace, dispatch,projectFiles,jobs,settings,skills }
}

if (process.env.MODMIND_MOBILE_BOOT === '1') {
  const root = process.env.MODMIND_MOBILE_HOME || path.join(process.env.HOME!, '.modmind-mobile')
  const config = JSON.parse(await fs.readFile(path.join(root, 'runtime.json'), 'utf8'))
  await startMobileServer({ root, runtime: path.join(root, 'runtime'), gradleHome: config.gradleHome, token: config.token, port: config.port || 19086 })
  console.log('ModMind 安卓本地服务已就绪 ' + MOBILE_VERSION)
}
