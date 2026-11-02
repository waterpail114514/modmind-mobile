import {promises as fs} from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'

export interface MobileJob {id:string;projectId?:string;title:string;status:'running'|'completed'|'failed'|'cancelled'|'interrupted';phase:string;startedAt:string;endedAt?:string;result?:any;error?:string}
export class MobileJobs {
  private values=new Map<string,MobileJob>()
  private controllers=new Map<string,AbortController>()
  private tail=Promise.resolve()
  constructor(private root:string){}
  async initialize(){await fs.mkdir(this.root,{recursive:true});const saved:MobileJob[]=await fs.readFile(path.join(this.root,'jobs.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return[];throw e});for(const value of saved.slice(-32))this.values.set(value.id,value.status==='running'?{...value,status:'interrupted',phase:'上次操作已中断，请检查后重试'}:value)}
  get busy(){return this.controllers.size>0}
  private persist(){const data=JSON.stringify([...this.values.values()].slice(-32));this.tail=this.tail.catch(()=>{}).then(async()=>{const file=path.join(this.root,'jobs.json');await fs.writeFile(file+'.pending',data);await fs.rename(file+'.pending',file)});return this.tail}
  list(projectId?:string){return [...this.values.values()].filter(j=>!projectId||j.projectId===projectId).reverse().slice(0,32)}
  read(id:string,projectId?:string){const value=this.values.get(id);if(!value||projectId&&value.projectId!==projectId)throw Error('操作记录不属于当前项目');return value}
  async cancel(id:string,projectId?:string){const job=this.read(id,projectId);this.controllers.get(id)?.abort(Error('用户已取消'));return job}
  async start(title:string,projectId:string|undefined,work:(signal:AbortSignal,phase:(text:string)=>void)=>Promise<any>){
    if(this.busy)throw Error('已有文件或下载操作进行中，请等待或取消')
    const controller=new AbortController(),job:MobileJob={id:randomUUID(),projectId,title,status:'running',phase:title,startedAt:new Date().toISOString()}
    this.values.set(job.id,job);this.controllers.set(job.id,controller)
    while(this.values.size>32){const old=[...this.values.values()].find(v=>v.status!=='running');if(!old)break;this.values.delete(old.id)}
    await this.persist()
    void(async()=>{try{job.result=await work(controller.signal,text=>{job.phase=text.slice(0,160)});job.status='completed';job.phase='已完成'}catch(e){job.status=controller.signal.aborted?'cancelled':'failed';job.error=e instanceof Error?e.message:String(e);job.phase=job.status==='cancelled'?'已取消':'未完成'}finally{job.endedAt=new Date().toISOString();this.controllers.delete(job.id);await this.persist()}})()
    return {...job}
  }
}
