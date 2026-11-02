import {useEffect,useState} from 'react'
import {Download,LoaderCircle,RotateCcw,Trash2} from 'lucide-react'
import {native,rpc} from './bridge'
import type {Project} from './types'
import {useConfirmDialog} from '../../src/renderer/src/components/InteractionDialogs'
import {size,waitJob} from './jobs'

export default function ProjectManager({project,onChanged,onRemoved}:{project:Project;onChanged(project:Project):void;onRemoved():void}){
  const [name,setName]=useState(project.name),[info,setInfo]=useState<any>(),[scan,setScan]=useState<any>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[job,setJob]=useState<any>(),[busy,setBusy]=useState(false),confirm=useConfirmDialog()
  const refresh=async()=>{setInfo(await rpc('project',{operation:'snapshots',projectId:project.id}));setScan(await rpc('project',{operation:'scan',projectId:project.id}))}
  useEffect(()=>{void refresh().catch(e=>setError(e.message))},[project.id])
  const action=async(operation:string,extra:object={})=>{setBusy(true);setError('');setNotice('');try{let result=await rpc<any>('project',{operation,projectId:project.id,...extra});if(result.status==='running'){setJob(result);result=await waitJob(result.id,setJob)}if(operation==='archive'){await native('export',{artifactId:result.id});setNotice('已保存到下载/ModMind')}else if(operation==='rename')onChanged(result);else if(operation==='delete'){onRemoved();return}else setNotice('已完成');await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false);setJob(undefined)}}
  return <div className="panel-scroll project-manage">
    <form onSubmit={e=>{e.preventDefault();void action('rename',{name})}}><label className="field">项目名称<input aria-label="修改项目名称" value={name} maxLength={100} onChange={e=>setName(e.target.value)} disabled={busy}/></label><button className="text-button" disabled={busy||!name.trim()||name===project.name}>保存名称</button></form>
    <div className="setting-row"><span>项目源码</span><span className="muted">{scan?size(scan.bytes)+' · '+scan.files+' 个文件':'正在读取'}</span></div>
    <button className="secondary-button" disabled={busy||!scan} onClick={()=>{void confirm.confirm({title:'导出完整项目源码？',message:'包含源码、配置和资源，排除构建缓存、游戏运行时及账号会话。当前文件约 '+size(scan?.bytes||0)+'，下载目录中的备份由你自行保留或清理。',confirmLabel:'导出源码 ZIP'}).then(ok=>{if(ok)void action('archive')})}}><Download size={17}/>导出项目源码</button>
    <div className="setting-row"><strong>轻量恢复</strong><span className="muted">{info?size(info.bytes)+' / '+size(info.limit):'正在读取'}</span></div>
    <label className="setting-row"><span>AI 修改前创建恢复点</span><input type="checkbox" aria-label="AI 修改前创建恢复点" checked={info?.automatic??true} disabled={busy||!info} onChange={e=>{void action('recovery_settings',{automatic:e.target.checked})}}/></label>
    <p className="muted">每项目最多 3 个，共用 128 MiB。保存源码、配置和小型资源，不复制模组 JAR 或游戏缓存。</p>
    <button className="text-button" disabled={busy||!info} onClick={()=>void action('snapshot',{label:'手动恢复点'})}>创建恢复点</button>
    <div className="restore-list">{info?.points.map((point:any)=><div className="restore-row" key={point.id}><span><strong>{point.label}</strong><small>{new Date(point.createdAt).toLocaleString()} · {point.files} 个文件</small></span><button className="icon-button" aria-label={'恢复'+point.id} disabled={busy} onClick={()=>{void confirm.confirm({title:'恢复所保存的编辑文件？',message:'当前内容会先建立恢复点。模组 JAR 与未收录的文件保留。',confirmLabel:'恢复文件'}).then(ok=>{if(ok)void action('restore_snapshot',{snapshotId:point.id,confirmed:true})})}}><RotateCcw size={17}/></button><button className="icon-button" aria-label={'移除恢复点'+point.id} disabled={busy} onClick={()=>{void confirm.confirm({title:'移除此恢复点？',message:'项目文件保留，移除后无法从此恢复点找回。',confirmLabel:'移除恢复点',tone:'danger'}).then(ok=>{if(ok)void action('remove_snapshot',{snapshotId:point.id,confirmed:true})})}}><Trash2 size={16}/></button></div>)}</div>
    {busy?<div className="job-progress" role="status"><LoaderCircle size={17} className="spin"/><span>{job?.phase||'正在处理'}</span>{job?<button className="text-button" onClick={()=>void rpc('job',{operation:'cancel',jobId:job.id}).catch(e=>setError(e.message))}>取消</button>:null}</div>:null}
    {error?<p className="inline-error" role="alert">{error}</p>:null}{notice?<p className="inline-notice" role="status">{notice}</p>:null}
    <button className="text-button danger" disabled={busy} onClick={()=>{void confirm.confirm({title:'删除「'+project.name+'」？',message:'手机内的项目源码将被删除。请先导出需要保留的文件；下载目录的导出产物保留。',confirmLabel:'删除项目',tone:'danger'}).then(ok=>{if(ok)void action('delete',{confirmed:true})})}}>删除项目</button>
    {confirm.dialog}
  </div>
}
