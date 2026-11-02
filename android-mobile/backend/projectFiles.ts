import {createReadStream,createWriteStream,promises as fs} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {Transform,type Readable} from 'node:stream'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import yauzl from 'yauzl'
import yazl from 'yazl'
import {scopedFilePath} from '../../src/main/scopedFilePath'
import {withProjectMutation} from '../../src/main/projectMutation'
import {copySnapshotFilesIncremental,snapshotFileHash} from '../../src/main/snapshotStore'
import {createModpackManifest,writeModpackManifest,addModpackFiles} from '../../src/main/modpackService'
import {validateProjectNameInput} from '../../src/shared/projectName'
import type {MobileWorkspace} from './workspace'
import type {ProjectInfo} from '../../src/shared/types'

const MiB=1024*1024
const GENERATED=new Set(['.gradle','.git','.modmind','.mobile-history','node_modules','build','out','run','run-server','exports','logs','crash-reports','__MACOSX'])
const EDIT=/\.(?:java|json|json5|snbt|toml|properties|gradle|kts|md|txt|mcfunction|lang|cfg|conf|yaml|yml|js|ts|xml|png|bbmodel|mcmeta)$/i
const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
type Entry={name:string;size:number;directory:boolean;source:string}
type Transfer={id:string;name:string;kind:'mod'|'modpack';namespace:string;loader:string;minecraftVersion:string;files:number;bytes:number;archiveBytes:number;skipped:number;prefix:string;createdAt:string;warnings:string[]}
type RestorePoint={id:string;projectId:string;label:string;createdAt:string;files:number;bytes:number;hashes:Record<string,string>;metadata:any;scope:'editable';tree:string[]}

export class MobileProjectFiles {
  readonly archiveLimit=1024*MiB
  readonly unpackedLimit=2048*MiB
  readonly recoveryLimit:number
  private transfers:string
  private recovery:string
  private sourceNames=new Map<string,string>()
  private automatic=new Map<string,boolean>()
  constructor(private workspace:MobileWorkspace,limits:{recoveryBytes?:number}={}){this.recoveryLimit=Math.min(128*MiB,limits.recoveryBytes??128*MiB);this.transfers=path.join(workspace.options.root,'transfers');this.recovery=path.join(workspace.options.root,'recovery')}
  async initialize(){for(const dir of [this.transfers,this.recovery])await fs.mkdir(dir,{recursive:true});for(const name of await fs.readdir(this.transfers)){if(!/^[a-f0-9-]{36}$/.test(name))continue;const file=path.join(this.transfers,name);if(Date.now()-(await fs.stat(file)).mtimeMs>86400000)await fs.rm(file,{recursive:true,force:true})}}
  async freeBytes(){const stat=await fs.statfs(this.workspace.options.root);return stat.bavail*stat.bsize}
  private async automaticEnabled(projectId:string){if(!this.automatic.has(projectId)){const value=await fs.readFile(path.join(this.recovery,'settings.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return{};throw e});this.automatic.set(projectId,value[projectId]!==false)}return this.automatic.get(projectId)!}
  async setAutomatic(projectId:string,automatic:boolean){await this.workspace.project(projectId);const file=path.join(this.recovery,'settings.json'),value=await fs.readFile(file,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return{};throw e});value[projectId]=automatic;await fs.writeFile(file,JSON.stringify(value));this.automatic.set(projectId,automatic);return this.recoveryInfo(projectId)}
  async ensureAutomatic(projectId:string){if(await this.automaticEnabled(projectId))await this.snapshot(projectId,'AI 修改前',new AbortController().signal)}
  private async space(bytes:number){if(await this.freeBytes()<bytes+128*MiB)throw Error('手机可用空间不足，请先清理空间；项目尚未修改')}
  private pathName(name:string){const value=name.replaceAll('\\','/');if(!value||value.startsWith('/')||/[\0:\u0001-\u001f]/.test(value)||value.split('/').some(p=>p==='..'||p==='.')||value.length>1024)throw Error('压缩包包含不安全的路径');return value}
  private excluded(name:string){const parts=name.replaceAll('\\','/').split('/');return parts.some(p=>GENERATED.has(p))||['mobile.project.json','modmind-transfer.json','.DS_Store'].includes(parts.at(-1)||'')}
  private async zip(file:string,each:(zip:yauzl.ZipFile,entry:yauzl.Entry)=>Promise<void>){
    await new Promise<void>((resolve,reject)=>{yauzl.open(file,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{if(error||!zip)return reject(error||Error('无法打开项目压缩包'));let failed=false;const fail=(e:unknown)=>{if(!failed){failed=true;zip.close();reject(e)}};zip.on('error',fail);zip.on('end',resolve);zip.on('entry',(entry:yauzl.Entry)=>{void each(zip,entry).then(()=>{if(!failed)zip.readEntry()}).catch(fail)});zip.readEntry()})})
  }
  private stream(zip:yauzl.ZipFile,entry:yauzl.Entry){return new Promise<Readable>((resolve,reject)=>zip.openReadStream(entry,(e,s)=>e||!s?reject(e||Error('读取压缩包失败')):resolve(s)))}
  private async entries(file:string){
    const result:Entry[]=[],names=new Set<string>();let total=0,count=0,skipped=0
    await this.zip(file,async(_zip,entry)=>{if(++count>50000)throw Error('压缩包文件数超过 50000');const name=this.pathName(entry.fileName),mode=(entry.externalFileAttributes>>>16)&0o170000;if(mode!==0&&mode!==0o100000&&mode!==0o040000)throw Error('项目压缩包不能包含符号链接或特殊文件');const key=name.replace(/\/$/,'').toLocaleLowerCase();if(names.has(key))throw Error('压缩包存在重名路径');names.add(key);if(entry.isEncrypted())throw Error('不支持加密的项目压缩包');if(this.excluded(name)){skipped++;return}if(entry.uncompressedSize>512*MiB)throw Error('压缩包单文件超过 512 MiB');total+=entry.uncompressedSize;if(total>this.unpackedLimit)throw Error('项目展开后超过 2 GiB');result.push({name,size:entry.uncompressedSize,directory:name.endsWith('/'),source:entry.fileName})})
    return {entries:result,total,skipped}
  }
  private async smallJson(file:string,name:string){let value:any=null;await this.zip(file,async(zip,e)=>{if(e.fileName!==name)return;if(e.uncompressedSize>MiB)throw Error('项目描述文件过大');const chunks:Buffer[]=[];for await(const chunk of await this.stream(zip,e))chunks.push(chunk as Buffer);value=JSON.parse(Buffer.concat(chunks).toString('utf8'))});return value}
  async receive(input:Readable,name:string){
    if(!/\.(zip|mrpack)$/i.test(name))throw Error('请选择 ZIP 项目或 mrpack 整合包')
    if((await fs.readdir(this.transfers)).length>=8)throw Error('待导入项目过多，请先完成或取消之前的导入')
    const id=randomUUID(),dir=path.join(this.transfers,id);await fs.mkdir(dir);let bytes=0
    try{await this.space(16*MiB);await pipeline(input,new Transform({transform:(chunk,_enc,cb)=>{bytes+=chunk.length;cb(bytes>this.archiveLimit?Error('项目压缩包超过 1 GiB'):null,chunk)}}),createWriteStream(path.join(dir,'source.zip'),{flags:'wx'}));return await this.inspect(id,name)}catch(e){await fs.rm(dir,{recursive:true,force:true});throw e}
  }
  private async ticket(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('导入记录无效');return path.join(this.transfers,id)}
  async inspect(id:string,name?:string):Promise<Transfer>{
    const dir=await this.ticket(id),file=path.join(dir,'source.zip');if(!name)return JSON.parse(await fs.readFile(path.join(dir,'transfer.json'),'utf8'))
    const found=await this.entries(file),files=found.entries.filter(e=>!e.directory),roots=new Set(files.map(e=>e.name.split('/')[0]));const prefix=roots.size===1&&files.every(e=>e.name.includes('/'))?[...roots][0]+'/':''
    const names=files.map(e=>e.name.slice(prefix.length)),description=await this.smallJson(file,prefix+'modmind.project.json')||{},mobile=await this.smallJson(file,prefix+'modmind-transfer.json')||{}
    const pack=await this.smallJson(file,prefix+'modmind.pack.json'),mrpack=await this.smallJson(file,prefix+'modrinth.index.json')
    const kind:Transfer['kind']=pack||mrpack||description.kind==='modpack'||names.some(n=>n.startsWith('mods/'))?'modpack':'mod'
    const fabric=await this.smallJson(file,prefix+'src/main/resources/fabric.mod.json')
    const loader=String(description.loader||mobile.project?.loader||(mrpack?.dependencies?.['fabric-loader']?'fabric':mrpack?.dependencies?.forge?'forge':'fabric'))
    const minecraftVersion=String(description.minecraftVersion||mobile.project?.minecraftVersion||mrpack?.dependencies?.minecraft||'1.21.1')
    const namespace=String(description.namespace||mobile.project?.namespace||fabric?.id||'imported_'+id.slice(0,8)).replace(/[^a-z0-9_]/g,'_').slice(0,48)
    const warnings:string[]=[];if(loader!=='fabric'||minecraftVersion!=='1.21.1')warnings.push('此项目可编辑；当前手机构建仅验证 Fabric 1.21.1')
    if(pack?.modules?.length)warnings.push('桌面关联模块不会访问原绝对路径，请确认源码或构建 JAR 已包含在归档中')
    if(mrpack?.files?.length)warnings.push('此整合包还有 '+mrpack.files.length+' 个在线依赖，导入后需要主动下载')
    if(kind==='mod'&&!names.some(n=>/^build\.gradle(?:\.kts)?$/.test(n)))throw Error('归档中未找到 Gradle 模组项目；请压缩项目根目录后导入')
    const value:Transfer={id,name:validateProjectNameInput(String(description.name||mobile.project?.name||mrpack?.name||name.replace(/\.(zip|mrpack)$/i,''))),kind,namespace:/^[a-z]/.test(namespace)?namespace:'project_'+id.slice(0,8),loader,minecraftVersion,files:files.length,bytes:found.total,archiveBytes:(await fs.stat(file)).size,skipped:found.skipped,prefix,createdAt:new Date().toISOString(),warnings}
    await this.space(value.bytes);await fs.writeFile(path.join(dir,'transfer.json'),JSON.stringify(value));return value
  }
  async discard(id:string){await fs.rm(await this.ticket(id),{recursive:true,force:true});return {removed:true}}
  async commit(id:string,name:string|undefined,signal:AbortSignal,phase:(text:string)=>void){
    const dir=await this.ticket(id),info=await this.inspect(id),file=path.join(dir,'source.zip'),found=await this.entries(file);await this.space(found.total)
    const stage=path.join(dir,'content');await fs.rm(stage,{recursive:true,force:true});await fs.mkdir(stage);const selected=new Map(found.entries.map(e=>[e.source,e]));let done=0
    try{await this.zip(file,async(zip,entry)=>{signal.throwIfAborted();const item=selected.get(entry.fileName);if(!item)return;const relative=item.name.slice(info.prefix.length);if(!relative)return;const target=await scopedFilePath(stage,relative);if(item.directory){await fs.mkdir(target,{recursive:true});return}await fs.mkdir(path.dirname(target),{recursive:true});let size=0;await pipeline(await this.stream(zip,entry),new Transform({transform:(chunk,_enc,cb)=>{size+=chunk.length;cb(size>item.size?Error('压缩包解压体积不匹配'):null,chunk)}}),createWriteStream(target,{flags:'wx'}),{signal});phase('正在导入 '+(++done)+' / '+info.files)})
      signal.throwIfAborted();const project=await this.workspace.adopt(stage,{...info,name:name||info.name})
      await fs.rm(dir,{recursive:true,force:true});return {project,warnings:info.warnings,files:done}
    }catch(e){await fs.rm(stage,{recursive:true,force:true});throw e}
  }
  async scan(projectId:string,editable=false){const project=await this.workspace.project(projectId),files:Array<{path:string;bytes:number}>=[];let bytes=0
    const walk=async(folder:string,relative='')=>{for(const e of await fs.readdir(folder,{withFileTypes:true})){const rel=relative?relative+'/'+e.name:e.name;if(this.excluded(rel)||e.isSymbolicLink())continue;if(e.isDirectory()){await walk(path.join(folder,e.name),rel);continue}if(!e.isFile()||editable&&!EDIT.test(e.name))continue;const stat=await fs.stat(path.join(folder,e.name));if(editable&&stat.size>4*MiB)throw Error('可编辑文件 '+rel+' 超过 4 MiB，无法创建轻量恢复点；可主动导出完整项目');bytes+=stat.size;if(files.length>=50000||bytes>this.unpackedLimit)throw Error('项目超过当前归档容量');files.push({path:rel,bytes:stat.size})}}
    await walk(project.path);return {project,files,bytes}
  }
  async export(projectId:string,signal:AbortSignal,phase:(text:string)=>void){const {project,files,bytes}=await this.scan(projectId);await this.space(bytes*2);const output=path.join(project.path,'exports',project.namespace+'-source.zip');await fs.mkdir(path.dirname(output),{recursive:true});const zip=new yazl.ZipFile();for(const entry of files){signal.throwIfAborted();zip.addFile(await scopedFilePath(project.path,entry.path),entry.path)}zip.addBuffer(Buffer.from(JSON.stringify({format:'modmind-source',version:1,project:{name:project.name,namespace:project.namespace,kind:project.kind,loader:project.loader,minecraftVersion:project.minecraftVersion}})),'modmind-transfer.json');zip.end();phase('正在打包 '+files.length+' 个文件');try{await pipeline(zip.outputStream,createWriteStream(output),{signal});return await this.workspace.artifact(projectId,output,true)}catch(e){await fs.rm(output,{force:true});throw e}}
  private async points():Promise<RestorePoint[]>{const result:RestorePoint[]=[];for(const name of await fs.readdir(this.recovery)){if(!/^[a-f0-9-]{36}$/.test(name))continue;const p=await fs.readFile(path.join(this.recovery,name,'point.json'),'utf8').then(JSON.parse).catch(()=>null);if(p?.id===name)result.push(p)}return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
  // Recovery objects deliberately share inodes. Only this private store permits
  // those hard links; live project paths continue using scopedFilePath.
  private async recoveryFile(id:string,relative:string){this.pathName(relative);if(!/^[a-f0-9-]{36}$/.test(id))throw Error('恢复点无效');let target=path.join(this.recovery,id,'files');for(const part of relative.replaceAll('\\','/').split('/')){target=path.join(target,part);if((await fs.lstat(target)).isSymbolicLink())throw Error('恢复点包含符号链接')}if(!(await fs.stat(target)).isFile())throw Error('恢复文件无效');return target}
  async recoveryInfo(projectId:string){const points=await this.points();let bytes=0;const inodes=new Set<string>();const visit=async(dir:string)=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const target=path.join(dir,entry.name),st=await fs.stat(target),key=st.dev+':'+st.ino;if(!inodes.has(key)){inodes.add(key);bytes+=Math.max(st.size,(st.blocks||0)*512)}if(entry.isDirectory())await visit(target)}};await visit(this.recovery);return {points:points.filter(p=>p.projectId===projectId).map(({hashes,metadata,tree,...p})=>p),bytes,limit:this.recoveryLimit,scope:'editable',maxPerProject:3,automatic:await this.automaticEnabled(projectId)}}
  async snapshot(projectId:string,label:string,signal:AbortSignal,protect?:string){const project=await this.workspace.project(projectId);return withProjectMutation(project.path,async()=>{
    const scan=await this.scan(projectId,true);if(scan.bytes>this.recoveryLimit)throw Error('源码与可编辑资源超过 128 MiB，轻量恢复点未创建；请主动导出完整项目')
    const points=await this.points(),old=points.find(p=>p.projectId===projectId),id=randomUUID(),root=path.join(this.recovery,id),filtered=path.join(this.transfers,'snapshot-'+id);await this.space(scan.bytes)
    try{await fs.mkdir(filtered);for(const f of scan.files){signal.throwIfAborted();const target=path.join(filtered,f.path);await fs.mkdir(path.dirname(target),{recursive:true});const source=await scopedFilePath(project.path,f.path);await fs.link(source,target).catch(()=>fs.copyFile(source,target))}
      const copy=await copySnapshotFilesIncremental(filtered,path.join(root,'files'),()=>false,old?{root:path.join(this.recovery,old.id,'files'),hashes:old.hashes}:undefined)
      const point:RestorePoint={id,projectId,label:label.trim().slice(0,80)||'恢复点',createdAt:new Date().toISOString(),files:copy.fileCount,bytes:scan.bytes,hashes:copy.hashes,metadata:copy.metadata,scope:'editable',tree:scan.files.map(f=>f.path)}
      await fs.writeFile(path.join(root,'point.json'),JSON.stringify(point));let all=await this.points()
      const keep=new Set([id,...(protect?[protect]:[]),...all.filter(p=>p.projectId===projectId).map(p=>p.id)].filter((v,i,a)=>a.indexOf(v)===i).slice(0,3))
      for(const previous of all.filter(p=>p.projectId===projectId&&!keep.has(p.id)))await fs.rm(path.join(this.recovery,previous.id),{recursive:true,force:true})
      while((await this.recoveryInfo(projectId)).bytes>this.recoveryLimit){all=await this.points();const previous=all.filter(p=>p.id!==id&&p.id!==protect).at(-1);if(!previous)throw Error('恢复点容量不足');await fs.rm(path.join(this.recovery,previous.id),{recursive:true,force:true})}
      return this.recoveryInfo(projectId)
    }catch(e){await fs.rm(root,{recursive:true,force:true});throw e}finally{await fs.rm(filtered,{recursive:true,force:true})}
  })}
  async restore(projectId:string,id:string,signal:AbortSignal){const point=(await this.points()).find(p=>p.id===id&&p.projectId===projectId);if(!point)throw Error('恢复点不属于此项目');const project=await this.workspace.project(projectId)
    return withProjectMutation(project.path,async()=>{for(const rel of point.tree){signal.throwIfAborted();const src=await this.recoveryFile(id,rel);if((await snapshotFileHash(src)).sha256!==point.hashes[rel])throw Error('恢复点文件校验失败，项目未修改')}
      await this.snapshot(projectId,'恢复前',signal,id);for(const rel of point.tree){const source=path.join(this.recovery,id,'files',rel),destination=await scopedFilePath(project.path,rel);await fs.mkdir(path.dirname(destination),{recursive:true});const pending=destination+'.restore-'+randomUUID();await fs.copyFile(source,pending);await fs.rename(pending,destination)}return {restored:point.tree.length,scope:'editable',binaryFilesRetained:true}
    })
  }
  async removeSnapshot(projectId:string,id:string){const point=(await this.points()).find(p=>p.id===id&&p.projectId===projectId);if(!point)throw Error('恢复点不属于此项目');await fs.rm(path.join(this.recovery,id),{recursive:true,force:true});return this.recoveryInfo(projectId)}
  async search(projectId:string,query:string,content=false){if(!query.trim())return {matches:[],truncated:false};const scan=await this.scan(projectId,true),matches:Array<{path:string;line?:number;text?:string}>=[];let bytes=0;const q=query.toLocaleLowerCase();for(const f of scan.files){if(!content){if(f.path.toLocaleLowerCase().includes(q))matches.push({path:f.path})}else if(!/\.(png|bbmodel)$/i.test(f.path)&&f.bytes<=256*1024&&bytes<8*MiB){bytes+=f.bytes;const text=await fs.readFile(await scopedFilePath(scan.project.path,f.path),'utf8');for(const [i,line]of text.split(/\r?\n/).entries())if(line.toLocaleLowerCase().includes(q)){matches.push({path:f.path,line:i+1,text:line.slice(0,240)});if(matches.length>=100)break}}if(matches.length>=100)break}return {matches:matches.slice(0,100),truncated:matches.length>=100||bytes>=8*MiB}}
  async move(projectId:string,from:string,to:string,revision:string){const project=await this.workspace.project(projectId);return withProjectMutation(project.path,async()=>{const doc=await this.workspace.read(projectId,from);if(!doc.exists||doc.revision!==revision)throw Error('文件已变化，请重新读取');await this.workspace.read(projectId,to);const target=await scopedFilePath(project.path,to);if(await fs.lstat(target).catch(()=>null))throw Error('目标文件已存在');await fs.mkdir(path.dirname(target),{recursive:true});await fs.rename(await scopedFilePath(project.path,from),target);return {moved:true,path:to}})}
  async removeFile(projectId:string,file:string,revision:string){const project=await this.workspace.project(projectId);return withProjectMutation(project.path,async()=>{const doc=await this.workspace.read(projectId,file);if(!doc.exists||doc.revision!==revision)throw Error('文件已变化，请重新读取');await this.snapshot(projectId,'删除文件前',new AbortController().signal);await fs.unlink(await scopedFilePath(project.path,file));return {removed:true,path:file}})}
}
