import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import { normalizeImageGenerationRequest } from '../../src/shared/imageStudioRequest'
import { networkFetch } from '../../src/main/networkRequest'
import { openAiV1BaseUrl } from '../../src/main/deviceIntegration'
import { scopedFilePath } from '../../src/main/scopedFilePath'
import type { MobileWorkspace } from './workspace'
import type { MobileAccount } from './account'
import { mobileImageResponse } from './imageResponse'

// PNGJS supplies a portable decoder; desktop Sharp has no Android binary here.
function png(bytes: Buffer) {
  if (bytes.length > 20 * 1024 * 1024 || bytes.length < 24 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw Error('手机试验版当前只接收不超过 20 MiB 的 PNG 图片')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (!width || !height || width * height > 16777216) throw Error('图片像素超过手机预览限制')
  const decoded = PNG.sync.read(bytes, { checkCRC: true })
  return { bytes: PNG.sync.write(decoded), width, height }
}
export class MobileAssets {
  private startingImage=false
  private imageTask?: { id: string; projectId: string; status: string; prompt: string; error?: string; result?: any; controller: AbortController }
  constructor(private workspace: MobileWorkspace, private account: MobileAccount) {}
  get busy() { return this.imageTask?.status === 'running' }
  private imageRoot(id: string) { return path.join(this.workspace.options.root, 'images', id) }
  async images(input: any, ui: boolean) {
    if(input.operation!=='generate')return this.imageOperation(input,ui)
    if(this.startingImage)throw Error('图片请求正在准备，请稍候')
    this.startingImage=true
    try{return await this.imageOperation(input,ui)}finally{this.startingImage=false}
  }
  private async imageOperation(input:any,ui:boolean){
    const project = await this.workspace.project(input.projectId)
    const root = this.imageRoot(project.id); await fs.mkdir(root, { recursive: true })
    const receipt=async(id:string)=>{
      if(!/^[a-f0-9-]{36}$/.test(id))throw Error('图片请求标识无效')
      if(this.imageTask?.id===id&&this.imageTask.projectId===project.id){const {controller,...value}=this.imageTask;return value}
      const value=await fs.readFile(path.join(root,'requests',id+'.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error})
      return value?.status==='running'?{...value,status:'interrupted',error:'上次请求已中断，请先核对额度；不会自动重新生成'}:value
    }
    if(input.operation==='status')return {task:await receipt(input.requestId)}
    if (input.operation === 'provider') return this.account.imageProvider()
    if (input.operation === 'list') {
      const names = (await fs.readdir(root)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).slice(0, 100)
      const images = await Promise.all(names.map(n => fs.readFile(path.join(root,n), 'utf8').then(JSON.parse)))
      const live=this.imageTask?.projectId===project.id?this.imageTask:null
      const saved=live?null:await fs.readFile(path.join(root,'task.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error})
      const receipt=saved?.status==='running'?{...saved,status:'interrupted',error:'上次图片请求在环境重启时中断。服务商可能仍在生成，请先核对额度再重试'}:saved
      return { images: images.sort((a,b) => b.createdAt.localeCompare(a.createdAt)), task: live?{id:live.id,status:live.status,error:live.error,result:live.result}:receipt }
    }
    if (input.operation === 'read') { const file = await scopedFilePath(root, input.imageId + '.png'); const value = png(await fs.readFile(file)); return { dataUrl: 'data:image/png;base64,' + value.bytes.toString('base64'), width: value.width, height: value.height } }
    if(input.operation==='remove'){
      if(!ui)throw Error('请在对话内移除历史图片')
      for(const suffix of ['.png','.json'])await fs.rm(await scopedFilePath(root,input.imageId+suffix),{force:true})
      const info='图片已从历史移除，项目中的文件会保留'
      if(this.imageTask?.projectId===project.id&&this.imageTask.result?.id===input.imageId){this.imageTask.status='removed';this.imageTask.error=info}
      const files=[path.join(root,'task.json'),...(await fs.readdir(path.join(root,'requests')).catch(error=>{if(error.code==='ENOENT')return[];throw error})).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(name=>path.join(root,'requests',name))]
      for(const file of files){const old=await fs.readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error});if(old?.result?.id===input.imageId){await fs.writeFile(file+'.pending',JSON.stringify({...old,status:'removed',error:info}));await fs.rename(file+'.pending',file)}}
      return {removed:true,imageId:input.imageId}
    }
    if (input.operation === 'apply') {
      if (!/\.png$/i.test(input.path) || input.path.split(/[\\/]/).some((p: string) => p.startsWith('.')) || input.path.length > 512) throw Error('请填写项目内的 PNG 路径')
      const file = await scopedFilePath(project.path, input.path)
      const exists = await fs.lstat(file).then(() => true).catch(e => { if (e.code !== 'ENOENT') throw e; return false })
      if (exists) throw Error('目标文件已存在，请换一个名称，避免覆盖已有贴图')
      const source = await scopedFilePath(root, input.imageId + '.png'); const value = png(await fs.readFile(source))
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(await scopedFilePath(project.path, input.path), value.bytes, { flag: 'wx' })
      return { saved: true, path: input.path, width: value.width, height: value.height }
    }
    if (input.operation === 'cancel') { if (this.imageTask?.projectId === project.id) this.imageTask.controller.abort(); return { cancelled: true } }
    if (!ui || input.operation !== 'generate') throw Error('请在对话内确认生成图片')
    const requestId=input.requestId||randomUUID(),existing=await receipt(requestId)
    if(existing){if(existing.prompt!==input.prompt)throw Error('图片请求与原描述不一致');return {accepted:true,taskId:existing.id,status:existing.status}}
    if (this.busy) throw Error('已有图片正在生成')
    if ((await fs.readdir(root)).filter(n => n.endsWith('.png')).length >= 32) throw Error('手机试验版每个项目最多保留 32 张图片')
    const request = normalizeImageGenerationRequest({ prompt: input.prompt, size: '1024x1024', quality: 'medium', count: 1, style: 'free' }, 'manual')
    const requestRoot=path.join(root,'requests');await fs.mkdir(requestRoot,{recursive:true})
    for(const name of await fs.readdir(requestRoot))if(/^[a-f0-9-]{36}\.json$/.test(name)){const file=path.join(requestRoot,name);if((await fs.stat(file)).mtimeMs<Date.now()-7*86400000)await fs.rm(file,{force:true})}
    if((await fs.readdir(requestRoot)).length>=128)throw Error('近期图片请求已达手机容量限制，请稍后再生成')
    const task = { id: requestId, projectId: project.id, prompt:input.prompt,status: 'running', controller: new AbortController() } as NonNullable<typeof this.imageTask>
    this.imageTask = task
    const persist=async()=>{const data=JSON.stringify({id:task.id,prompt:task.prompt,status:task.status,error:task.error,result:task.result});for(const file of [path.join(root,'task.json'),path.join(requestRoot,task.id+'.json')]){await fs.writeFile(file+'.pending',data);await fs.rename(file+'.pending',file)}}
    await persist()
    void (async () => {
      const timeout = setTimeout(() => task.controller.abort(), 300000)
      try {
        const lease = await this.account.imageLease(task.controller.signal)
        // A single explicit request: generation is never retried automatically.
        const stream = lease.provider === 'secondary' || lease.provider === 'ls'
        const response = await networkFetch(openAiV1BaseUrl(lease.baseUrl) + '/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + lease.apiKey, 'Content-Type': 'application/json' }, signal: task.controller.signal, body: JSON.stringify({ model: lease.model, prompt: request.prompt, size: request.size, quality: request.quality, moderation:'auto', n: 1, ...(stream?{stream:true,partial_images:0}:{}) }) })
        if (!response.ok) throw Error('图片生成失败（' + response.status + '），请先核对额度后再决定是否重试')
        const value = png(await mobileImageResponse(response,task.controller.signal)), id = randomUUID()
        const image = { id, prompt: request.prompt, model: lease.model, createdAt: new Date().toISOString(), width: value.width, height: value.height }
        await fs.writeFile(path.join(root,id+'.png'),value.bytes,{flag:'wx'}); await fs.writeFile(path.join(root,id+'.json'),JSON.stringify(image),{flag:'wx'})
        task.result = image; task.status = 'completed'
      } catch (error) { task.status = task.controller.signal.aborted ? 'cancelled' : 'failed'; task.error = task.controller.signal.aborted ? '已停止等待。服务商可能仍在生成，请先核对额度再重试' : error instanceof Error ? error.message : '图片生成失败' }
      finally { clearTimeout(timeout); await persist().catch(()=>{task.error='图片请求状态未能保存，请核对额度后再重试'}) }
    })()
    return { accepted: true, taskId: task.id }
  }
  async models(input: any) {
    const project = await this.workspace.project(input.projectId)
    if (input.operation === 'list') {
      const queue = ['']; const files: string[] = []; let scanned = 0
      while (queue.length && scanned < 500) {
        const folder = queue.shift()!; let offset: number | null = 0
        do {
          const page = await this.workspace.files(project.id, folder, offset); offset = page.nextOffset
          for (const entry of page.entries) { scanned++; if (entry.directory && entry.path.split('/').length < 16) queue.push(entry.path); else if (/\.bbmodel$/i.test(entry.path) || /\/models\/.+\.json$/i.test(entry.path)) files.push(entry.path) }
        } while (offset !== null && scanned < 500)
      }
      return { files: files.slice(0, 100), partial: queue.length > 0 || scanned >= 500 }
    }
    if (input.operation === 'create') {
      if (!/\.bbmodel$/i.test(input.path)) throw Error('新建模型使用 .bbmodel 扩展名')
      const cube = { uuid: randomUUID(), name: '立方体', type: 'cube', from: [0,0,0], to: [16,16,16], origin: [8,8,8], faces: Object.fromEntries(['north','south','east','west','up','down'].map(face => [face, { uv: [0,0,16,16] }])) }
      return this.workspace.save(project.id, { path: input.path, revision: null, content: JSON.stringify({ meta: { format_version: '4.10', model_format: 'free', box_uv: false }, name: path.basename(input.path,'.bbmodel'), resolution: { width: 16, height: 16 }, elements: [cube], outliner: [cube.uuid], textures: [] },null,2) })
    }
    const document = await this.workspace.read(project.id,input.path)
    if (input.operation === 'read') return document
    if (input.operation !== 'preview') throw Error('未知的模型操作')
    const data = JSON.parse(document.content)
    if (!Array.isArray(data.elements) || !data.elements.length || data.elements.length > 512) throw Error('手机基础预览支持 1–512 个几何部件；父模型引用需要完整建模工具解析')
    let faces = 0
    for (const element of data.elements) { faces += Object.keys(element.faces || {}).length; if (Object.keys(element.vertices || {}).length > 10000) throw Error('模型网格超过手机预览限制') }
    if (faces > 10000) throw Error('模型网格超过手机预览限制')
    const warnings: string[] = []
    if (/\.bbmodel$/i.test(input.path)) {
      const textures: Record<string,string> = {}; let pixels=0
      for (const [index, texture] of (data.textures || []).slice(0,16).entries()) {
        if (!/^data:image\/png;base64,/.test(texture.source || '')) { warnings.push('外部贴图暂以素色显示'); continue }
        const value = png(Buffer.from(texture.source.split(',')[1], 'base64'))
        pixels+=value.width*value.height;if(pixels>16777216)throw Error('模型贴图总像素超过手机预览限制')
        textures[String(index)] = 'data:image/png;base64,' + value.bytes.toString('base64')
      }
      return { path: input.path, name: path.basename(input.path), warnings, blockbench: { elements: data.elements, outliner: data.outliner || [], resolution: data.resolution || { width:16,height:16 }, boxUv: data.meta?.box_uv === true, textures } }
    }
    if (data.parent) warnings.push('基础预览仅显示当前文件的几何体')
    if (Object.keys(data.textures || {}).length) warnings.push('Java 模型贴图暂以素色显示')
    return { path: input.path, name: path.basename(input.path), warnings, minecraft: { elements: data.elements, textures: {}, display: data.display || {} } }
  }
}
