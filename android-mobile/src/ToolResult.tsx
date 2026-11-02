import { useEffect, useRef, useState } from 'react'
import { Box, Check, ChevronRight, Download, FileCode2, Image, LoaderCircle, Package, MoreHorizontal } from 'lucide-react'
import { native, rpc } from './bridge'
import type { Project, Task } from './types'
import { useConfirmDialog } from '../../src/renderer/src/components/InteractionDialogs'
import VerificationReport from './VerificationReport'
import ArtifactResult from './ArtifactResult'

const imageCache=new Map<string,{at:number;value:any}>(),imageLoads=new Map<string,Promise<any>>()
async function imageData(projectId:string,imageId:string){
  const key=projectId+':'+imageId,old=imageCache.get(key)
  if(old&&Date.now()-old.at<300000)return old.value
  if(imageLoads.has(key))return imageLoads.get(key)
  const request=rpc('images',{operation:'read',projectId,imageId}).then(value=>{imageCache.delete(key);imageCache.set(key,{at:Date.now(),value});while(imageCache.size>4)imageCache.delete(imageCache.keys().next().value!);return value}).finally(()=>imageLoads.delete(key))
  imageLoads.set(key,request);return request
}
function Picture({project,imageId,readOnly}:{project:Project;imageId:string;readOnly:boolean}){
  const [image,setImage]=useState<any>(),[error,setError]=useState(''),[path,setPath]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(''),[editing,setEditing]=useState(false)
  const host=useRef<HTMLDivElement>(null),confirm=useConfirmDialog(),[removed,setRemoved]=useState(false)
  const load=()=>{setError('');void imageData(project.id,imageId).then(setImage).catch(e=>setError(e.message))}
  useEffect(()=>{let alive=true;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&alive){load();observer.disconnect()}},{rootMargin:'200px'});if(host.current)observer.observe(host.current);return()=>{alive=false;observer.disconnect()}},[project.id,imageId])
  const defaultPath=(project.kind==='mod'?'src/main/resources/assets/'+project.namespace+'/textures/item/':'overrides/config/images/')+imageId.slice(0,8)+'.png'
  if(removed)return <p className="muted">历史图片已移除，项目中的贴图会保留。</p>
  return <div className="result-picture" ref={host}>{image?<img src={image.dataUrl} alt="已生成的图片" style={{imageRendering:image.width<=256?'pixelated':'auto'}}/>:<div className="picture-placeholder">{error?<button className="text-button" onClick={load}>重新载入图片</button>:<LoaderCircle size={20} className="spin"/>}</div>}{error?<p className="inline-error">{error}</p>:null}{!readOnly&&image?<div className="picture-actions">{editing?<form className="image-save" onSubmit={e=>{e.preventDefault();setBusy(true);void rpc('images',{operation:'apply',projectId:project.id,imageId,path}).then(()=>{setSaved(path);setEditing(false)}).catch(e=>setError(e.message)).finally(()=>setBusy(false))}}><input aria-label="图片保存路径" value={path} required onChange={e=>setPath(e.target.value)}/><button className="text-button" disabled={busy}>保存</button></form>:<button className="result-save" onClick={()=>{setPath(defaultPath);setEditing(true)}}>{saved?<><Check size={16}/>已保存到项目</>:<><Download size={16}/>保存到项目</>}</button>}<details className="picture-menu"><summary aria-label="图片操作"><MoreHorizontal size={18}/></summary><button onClick={()=>{void confirm.confirm({title:'移除历史图片？',message:'项目中已保存的贴图会保留。这张历史原图无法恢复。',confirmLabel:'移除历史图片',tone:'danger'}).then(async ok=>{if(ok){await rpc('images',{operation:'remove',projectId:project.id,imageId});imageCache.delete(project.id+':'+imageId);setRemoved(true)}}).catch(e=>setError(e.message))}}>移除历史图片</button></details></div>:null}{confirm.dialog}</div>
}
function ImageRequest({project,prompt,requestId,readOnly}:{project:Project;prompt:string;requestId:string;readOnly:boolean}){
  const [task,setTask]=useState<any>(),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const value=await rpc<any>('images',{operation:'status',projectId:project.id,requestId});if(active){setTask(value.task);setReady(true);if(value.task?.status==='running')timer=setTimeout(poll,1500)}}catch(e){if(active)setError((e as Error).message)}};void poll();return()=>{active=false;clearTimeout(timer)}},[project.id,requestId,busy])
  return <div className="inline-result image-request">{task?.status==='completed'&&task.result?.id?<Picture project={project} imageId={task.result.id} readOnly={readOnly}/>:<><div className="result-label"><Image size={19}/><strong>{task?.status==='running'?'正在生成图片':'图片描述'}</strong></div><p>{prompt}</p>{error||task?.error?<p className="inline-error" role="alert">{error||task.error}</p>:null}{!task?<div className="result-footer"><small>1 张 · 1024 × 1024 · 使用图片额度</small><button className="primary-button" disabled={!ready||busy} onClick={()=>{setBusy(true);setError('');void rpc('images',{operation:'generate',projectId:project.id,prompt,requestId}).catch(e=>setError(e.message)).finally(()=>setBusy(false))}}>生成图片</button></div>:task.status==='running'?<div className="result-footer"><span className="muted">完成后会出现在这里</span><button className="text-button" onClick={()=>{void rpc('images',{operation:'cancel',projectId:project.id}).catch(e=>setError(e.message))}}>停止等待</button></div>:<small>本次请求已保留，不会自动重复生成。</small>}</>}</div>
}
function BuildResult({project,taskId,onAction}:{project:Project;taskId:string;onAction(kind:'files'|'tasks'):void}){
  const [task,setTask]=useState<Task>(),[error,setError]=useState('')
  useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const result=await rpc<{tasks:Task[]}>('query',{operation:'tasks',projectId:project.id});if(active){const value=result.tasks.find(t=>t.id===taskId);setTask(value);if(value?.status==='running')timer=setTimeout(poll,1200)}}catch(e){if(active)setError((e as Error).message)}};void poll();return()=>{active=false;clearTimeout(timer)}},[project.id,taskId])
  return <div className="inline-result"><button className="result-label result-link" onClick={()=>onAction('tasks')}>{task?.status==='running'?<LoaderCircle size={19} className="spin"/>:<Package size={19}/>}<span>{task?.kind==='project-test'?task.phase:task?.status==='completed'?'模组已构建':task?.status==='failed'?'构建未完成':task?.status==='running'?'正在构建模组':'查看构建结果'}</span><ChevronRight size={16}/></button>{task?.evidence?<small>游戏运行尚未验证</small>:null}{task?.artifacts.map(artifact=><ArtifactResult key={artifact.id} artifact={artifact}/>)}{error?<p className="inline-error">{error}</p>:null}</div>
}
function JobResult({id,readOnly,onFile}:{id:string;readOnly:boolean;onFile(path:string):void}){
  const [job,setJob]=useState<any>(),[error,setError]=useState('')
  useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const value=await rpc<any>('job',{operation:'status',jobId:id});if(active){setJob(value);if(value.status==='running')timer=setTimeout(poll,1000)}}catch(e){if(active)setError((e as Error).message)}};void poll();return()=>{active=false;clearTimeout(timer)}},[id])
  return <div className="inline-result"><div className="result-label">{job?.status==='running'?<LoaderCircle size={18} className="spin"/>:<Check size={18}/>}<strong>{job?.title||'查看操作结果'}</strong></div>{job?<p className={job.error?'inline-error':'muted'}>{job.error||job.phase}</p>:null}{job?.result?.checks?<VerificationReport report={job.result} onFile={onFile}/>:null}{job?.result?.id&&job.result.name?<ArtifactResult artifact={job.result}/>:null}{job?.status==='running'&&!readOnly?<button className="text-button" onClick={()=>void rpc('job',{operation:'cancel',jobId:id}).catch(e=>setError(e.message))}>取消操作</button>:null}{error?<p className="inline-error">{error}</p>:null}</div>
}
export default function ToolResult({event,project,readOnly,onAction,onModel,onFile}:{event:any;project:Project;readOnly:boolean;onAction(kind:'files'|'tasks'):void;onModel(path:string):void;onFile(path:string):void}){
  const tool=event.payload?.mobileTool
  if(!tool||tool.status!=='completed')return null
  if(tool.jobId)return <JobResult id={tool.jobId} readOnly={readOnly} onFile={onFile}/>
  if(tool.operation==='image_draft'&&tool.prompt)return <ImageRequest project={project} prompt={tool.prompt} requestId={event.eventId} readOnly={readOnly}/>
  if(tool.operation==='image'&&tool.imageId)return <div className="inline-result"><Picture project={project} imageId={tool.imageId} readOnly={readOnly}/></div>
  if(tool.operation==='model_preview'&&tool.path)return <button className="inline-result result-link" onClick={()=>onModel(tool.path)}><Box size={22}/><span><strong>{tool.path.split('/').pop()}</strong><small>查看模型</small></span><ChevronRight size={18}/></button>
  if(tool.tool==='modmind_mobile_task'&&tool.taskId)return <BuildResult project={project} taskId={tool.taskId} onAction={onAction}/>
  if(tool.operation==='export'&&tool.artifact)return <div className="inline-result"><ArtifactResult artifact={tool.artifact}/></div>
  if(tool.operation==='save'&&tool.path)return <button className="file-result" onClick={()=>onFile(tool.path)}><FileCode2 size={16}/><span>{tool.path.split('/').pop()}</span><Check size={14}/></button>
  return null
}
