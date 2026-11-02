import {promises as fs} from 'node:fs'
import JSON5 from 'json5'
import {parse as parseSnbt} from 'ftbq-nbt'
import {PNG} from 'pngjs'
import {archiveEntries,archiveRead} from '../../src/main/archiveInspection'
import {scopedFilePath} from '../../src/main/scopedFilePath'
import {validateDataPackContent} from '../../feature-plugins/data-packs/src/main/dataPackService'
import type {MobileWorkspace} from './workspace'
import type {MobileProjectFiles} from './projectFiles'
export interface VerificationCheck {id:string;label:string;status:'passed'|'failed'|'warning'|'not_run';detail:string;path?:string}
export class MobileVerification {
  constructor(private workspace:MobileWorkspace,private files:MobileProjectFiles){}
  async inspect(projectId:string,signal:AbortSignal,phase:(text:string)=>void){
    const scan=await this.files.scan(projectId),checks:VerificationCheck[]=[];let examined=0,skipped=0,total=0
    const add=(id:string,label:string,status:VerificationCheck['status'],detail:string,file?:string)=>{if(checks.length<200)checks.push({id,label,status,detail,...(file?{path:file}:{})})}
    for(const file of scan.files){signal.throwIfAborted();if(!/\.(json|json5|snbt|bbmodel|mcmeta|png)$/i.test(file.path))continue
      if(file.bytes>4*1024*1024||total+file.bytes>32*1024*1024||examined>=1000){skipped++;continue}total+=file.bytes;examined++;phase('正在检查 '+examined+' 个文件')
      try{const bytes=await fs.readFile(await scopedFilePath(scan.project.path,file.path))
        if(/\.png$/i.test(file.path)){if(bytes.length<24||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16777216)throw Error('PNG 头或像素范围无效');PNG.sync.read(bytes,{checkCRC:true})}
        else if(/\.snbt$/i.test(file.path))parseSnbt(bytes.toString('utf8'))
        else if(/\.json5$/i.test(file.path))JSON5.parse(bytes.toString('utf8'))
        else{JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));if(/(?:^|\/)data\/[a-z0-9_.-]+\//.test(file.path)){
          const result=validateDataPackContent(scan.project.minecraftVersion,file.path,bytes.toString('utf8'));for(const error of result.errors)add('data:'+file.path,'数据包校验','failed',error,file.path);for(const warning of result.warnings)add('data-warning:'+file.path,'数据包校验范围','warning',warning,file.path)
        }}
      }catch(e){add('syntax:'+file.path,'文件校验','failed',(e as Error).message,file.path)}
    }
    add('file-summary','文件与资源',checks.some(c=>c.status==='failed')?'failed':'passed','实际检查 '+examined+' 个文件'+(skipped?'；'+skipped+' 个超过本轮检查范围':''))
    if(skipped)add('skipped','检查范围','warning','大文件、超过 1000 个文件或 32 MiB 总检查量的内容尚未检查；不是全部通过')
    if(scan.project.kind==='mod'){
      const target=scan.project.loader==='fabric'&&scan.project.minecraftVersion==='1.21.1'
      add('target','手机构建目标',target?'passed':'warning',target?'Fabric 1.21.1 / JDK 21':'当前项目可编辑，此构建组合尚未在安卓验证')
      const descriptor='src/main/resources/fabric.mod.json'
      if(scan.project.loader==='fabric')try{const data=JSON.parse(await fs.readFile(await scopedFilePath(scan.project.path,descriptor),'utf8'));if(typeof data.id!=='string'||!data.id||!data.version)throw Error('缺少模组 id 或 version');add('descriptor','模组描述','passed',data.id+' · '+data.version,descriptor)}catch(e){add('descriptor','模组描述','failed',(e as Error).message,descriptor)}
      const tests=scan.files.filter(f=>/^src\/test\//.test(f.path));add('project-tests','项目测试',tests.length?'not_run':'warning',tests.length?'发现 '+tests.length+' 个测试源码文件，可执行“运行项目测试”':'项目中尚未发现 src/test 测试；编译成功不代表有测试通过')
    }else{
      const manifest=await this.workspace.pack(projectId);add('pack-files','整合包清单','passed',manifest.mods.length+' 个本地模组')
      const known=new Map<string,string>(),dependencies:Array<{owner:string;ids:string[];file:string}>=[]
      for(const mod of manifest.mods.slice(0,512)){signal.throwIfAborted();try{const jar=await scopedFilePath(scan.project.path,'mods/'+mod.fileName),entries=await archiveEntries(jar)
        if(entries.includes('fabric.mod.json')){const data=JSON.parse((await archiveRead(jar,'fabric.mod.json')).toString('utf8'));if(known.has(data.id))add('duplicate:'+data.id,'重复模组','failed',data.id+' 同时出现在 '+known.get(data.id)+' 与 '+mod.fileName);known.set(data.id,mod.fileName);dependencies.push({owner:data.id,ids:Object.keys(data.depends||{}),file:mod.fileName})}
        else add('jar-metadata:'+mod.fileName,'模组元数据','warning','未找到 Fabric 描述；其他加载器或非标准 JAR 需要另行检查','mods/'+mod.fileName)
      }catch(e){add('jar:'+mod.fileName,'模组 JAR','failed',(e as Error).message,'mods/'+mod.fileName)}}
      for(const dependency of dependencies)for(const id of dependency.ids)if(!['minecraft','java','fabricloader'].includes(id)&&!known.has(id))add('dependency:'+dependency.owner+':'+id,'依赖声明','warning',dependency.owner+' 声明依赖 '+id+'；可能需补齐，也可能由内嵌 JAR 提供，尚未运行验证','mods/'+dependency.file)
      if(manifest.mods.length>512)add('mod-limit','模组检查范围','warning','本轮仅检查前 512 个 JAR')
    }
    const last=this.workspace.taskList(projectId).tasks.find(t=>t.status==='completed')
    add('compilation','最近构建',last?'passed':'not_run',last?'最近已完成操作：'+last.phase+'；不代表本次改动已重新构建':'尚无完成的手机构建记录')
    add('game-runtime','游戏运行','not_run','尚未在 Minecraft 中运行；静态检查、编译和项目测试均不能代替游戏实测')
    add('game-visual','画面与交互','not_run','安卓游戏启动器、渲染、账号与输入接入尚待单独真机原型验证')
    return {projectId,checkedAt:new Date().toISOString(),level:'static',passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed').length,warnings:checks.filter(c=>c.status==='warning').length,checks,gameVerified:false}
  }
}
