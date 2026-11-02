import {useState} from 'react'
import {Check,Download,LoaderCircle,Package,Share2} from 'lucide-react'
import {native} from './bridge'
import {size} from './jobs'
import type {Artifact} from './types'
export default function ArtifactResult({artifact}:{artifact:Artifact}){
  const [busy,setBusy]=useState(''),[feedback,setFeedback]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(false)
  const act=async(method:'export'|'share')=>{if(busy)return;setBusy(method);setError('');setFeedback('');try{const value=await native(method,{artifactId:artifact.id});if(method==='export'){setSaved(true);setFeedback('已导出到'+(value.location||'下载/ModMind'))}else setFeedback('已打开系统分享')}catch(e){setError(e instanceof Error?e.message:'操作未完成，请重试')}finally{setBusy('')}}
  const format=artifact.name.endsWith('.jar')?'模组 JAR':artifact.name.endsWith('.mrpack')?'整合包':artifact.name.endsWith('.zip')?'项目归档':'文件'
  return <div className="artifact-result" data-artifact-id={artifact.id}><div className="artifact-file"><span className="artifact-icon"><Package size={22} strokeWidth={1.6}/></span><span><strong>{artifact.name}</strong><small>{format} · {size(artifact.size)}</small></span></div><div className="artifact-actions"><button className="primary-button" disabled={Boolean(busy)} onClick={()=>void act('export')}>{busy==='export'?<LoaderCircle size={17} className="spin"/>:saved?<Check size={17}/>:<Download size={17}/>}导出</button><button className="secondary-button" disabled={Boolean(busy)} onClick={()=>void act('share')}>{busy==='share'?<LoaderCircle size={17} className="spin"/>:<Share2 size={17}/>}分享</button></div>{feedback?<p className="artifact-feedback" role="status">{feedback}</p>:null}{error?<p className="inline-error" role="alert">{error}</p>:null}</div>
}
