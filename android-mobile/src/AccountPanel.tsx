import { useEffect, useRef, useState } from 'react'
import { RefreshCw,UserRound } from 'lucide-react'
import MobileModelPicker from './MobileModelPicker'
import {modelCatalogFailure,modelCatalogKey,modelCatalogSelection} from '../../src/renderer/src/components/ModelCatalogRows'
import type {AiModelInfo} from '../../src/shared/types'
import { native, rpc } from './bridge'
import {selectedReasoningEfforts,REASONING_EFFORTS} from '../../src/shared/modelReasoning'
const message=(e:unknown)=>e instanceof Error?e.message:String(e)
function money(value:unknown){if(typeof value!=='string'||!/^\d+$/.test(value))return '未读取';return (BigInt(value)/100n).toString()+'.'+(BigInt(value)%100n).toString().padStart(2,'0')}
let cached:{at:number;identity:string;value:any}|undefined
export default function AccountPanel({close:_close,initialScope='settings'}:{close():void;initialScope?:'settings'|'workspace'|'inspiration'}){
  const [scope,setScope]=useState(initialScope),[switching,setSwitching]=useState<string>(),[selectionError,setSelectionError]=useState<{model:string;account?:string;message:string}>()
  const scopeRef=useRef(scope),mounted=useRef(true);scopeRef.current=scope
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const [state,setState]=useState<any>(null),[catalog,setCatalog]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false)
  const [custom,setCustom]=useState(false),[baseUrl,setBase]=useState(''),[apiKey,setKey]=useState(''),[model,setModel]=useState('')
  const [context,setContext]=useState(''),[compact,setCompact]=useState(''),[longer,setLonger]=useState(false),[settingsRevision,setSettingsRevision]=useState('')
  useEffect(()=>{void rpc<any>('settings',{operation:'read'}).then(s=>{setLonger(s.allowLongerContext);setSettingsRevision(s.revision)}).catch(()=>{})},[])
  useEffect(()=>{setContext(String(state?.preferences.modelContextWindows?.[state?.preferences.model]||''));setCompact(String(state?.preferences.modelAutoCompactTokenLimits?.[state?.preferences.model]||''))},[state?.preferences])
  const refresh=async()=>{const requested=scopeRef.current,value=await rpc<any>('account',{operation:'status',scope:requested});if(mounted.current&&requested===scopeRef.current)setState(value);return value}
  const act=async(fn:()=>Promise<void>)=>{setError('');setBusy(true);try{await fn()}catch(e){setError(message(e))}finally{setBusy(false)}}
  const loadModels=async(force=false)=>{setLoading(true);try{const value=await rpc('account',{operation:'catalog',refresh:force});if(mounted.current)setCatalog(value);return value}finally{if(mounted.current)setLoading(false)}}
  useEffect(()=>{let active=true;void refresh().catch(e=>{if(active)setError(message(e))});return()=>{active=false}},[scope])
  useEffect(()=>{
    if(!state?.connected)return
    let active=true
    const identity=state.username+':'+state.custom
    if(cached?.identity===identity&&Date.now()-cached.at<60000){setCatalog(cached.value);return}
    void loadModels().then(value=>{if(active)cached={at:Date.now(),identity,value}}).catch(e=>{if(active)setError(message(e))})
    return()=>{active=false}
  },[state?.connected,state?.username,state?.custom])
  useEffect(()=>{
    if(!state?.pending)return
    let active=true,timer:ReturnType<typeof setTimeout>
    const poll=async()=>{try{const result=await rpc<any>('account',{operation:'poll'});if(!active)return;if(result.status==='ok'){cached=undefined;await refresh();return}if(result.status==='expired'){setError('授权已过期，请重新登录');await refresh();return}timer=setTimeout(poll,2500)}catch(e){if(active)setError(message(e))}}
    timer=setTimeout(poll,1500);return()=>{active=false;clearTimeout(timer)}
  },[state?.pending?.expiresAt])
  const scanning=state?.scan?.status==='running',locked=busy||scanning||state?.executionBusy
  useEffect(()=>{
    if(!scanning)return
    let active=true,timer:ReturnType<typeof setTimeout>
    const poll=async()=>{try{const value=await refresh();if(!active)return;if(value.scan.status==='running'){timer=setTimeout(poll,1500);return}cached=undefined;await loadModels()}catch(e){if(active){setError(message(e));timer=setTimeout(poll,3000)}}}
    timer=setTimeout(poll,1000);return()=>{active=false;clearTimeout(timer)}
  },[scanning])
  const chooseModel=(choice:AiModelInfo)=>{if(locked)return;setSwitching(modelCatalogKey(choice));setSelectionError(undefined);void act(async()=>{try{const result=await rpc<any>('account',{operation:'select',scope,model:choice.id,...modelCatalogSelection(choice)});if(result.catalog)setCatalog(result.catalog);if(result.status&&result.status!=='ok')throw Error(result.message||'线路切换尚未完成');cached=undefined;await refresh();await loadModels()}catch(e){setSelectionError({model:choice.id,account:choice.account,message:modelCatalogFailure(e)});throw e}finally{setSwitching(undefined)}})}
  const scanModels=()=>void act(async()=>{setSelectionError(undefined);await rpc('account',{operation:'discover'});cached=undefined;const value=await refresh();if(value.scan.status!=='running')await loadModels()})
  const preference=(patch:any)=>act(async()=>{await rpc('account',{operation:'preferences',scope,model:state.preferences.model,...patch});await refresh()})
  return <section className="account-page"><label className="field">模型作用范围<select aria-label="模型作用范围" value={scope} disabled={locked} onChange={e=>{setState(null);setSelectionError(undefined);setScope(e.target.value as typeof scope)}}><option value="settings">全局默认</option><option value="workspace">工作台</option><option value="inspiration">灵感台</option></select></label>{scope!=='settings'&&state?.bound?<button className="text-button" disabled={locked} onClick={()=>void act(async()=>{await rpc('account',{operation:'reset',scope});await refresh()})}>跟随全局模型</button>:null}{state?.executionBusy?<p className="muted">请先停止当前 AI 任务，再切换模型。</p>:null}
    {error?<p className="inline-error" role="alert">{error}</p>:null}
    {!state?<div className="loading-row">正在读取账号</div>:state.connected?<>
      <details className="account-summary"><summary>账号与额度</summary><div className="account-identity"><UserRound size={20}/><strong>{state.username}</strong><button className="text-button" disabled={locked} onClick={()=>void act(async()=>{await rpc('account',{operation:'logout'});cached=undefined;setCatalog(undefined);await refresh()})}>退出</button></div>
      <div className="balance-row"><span>可用余额</span><strong>{state.custom?'由服务商统计':state.usage?'¥ '+money(state.usage.balanceCents):'尚未读取'}</strong><button className="icon-button" aria-label="刷新额度" disabled={locked} onClick={()=>void act(async()=>{await rpc('account',{operation:'usage'});await refresh()})}><RefreshCw size={17}/></button></div>
      {state.usage?<small className="quota-time">{new Date(state.usage.checkedAt).toLocaleString()}</small>:null}
      </details><MobileModelPicker catalog={catalog} preferences={state.preferences} scope={scope} loading={loading} scanning={scanning} disabled={locked} switching={switching} error={selectionError} onSelect={chooseModel} onScan={scanModels}/>
      <div className="model-scan-status" role="status">{scanning?state.scan.message:state.scan?.status==='complete'?`已扫描到 ${state.scan.models} 个可用模型`:state.scan?.message||''}</div>
      <details className="model-advanced"><summary>模型偏好</summary><fieldset disabled={locked}>
      <label className="field">思考强度<select aria-label="思考强度" value={state.preferences.reasoningLevel} disabled={locked} onChange={e=>void preference({reasoningLevel:e.target.value})}><option value="auto">自动</option>{selectedReasoningEfforts(state.preferences.model,state.preferences.reasoningEffortOptions).map(level=><option key={level} value={level}>{level}</option>)}</select></label>
      <details><summary>可选思考档位</summary>{REASONING_EFFORTS.map(level=><label className="setting-row" key={level}><span>{level}</span><input type="checkbox" disabled={locked} checked={selectedReasoningEfforts(state.preferences.model,state.preferences.reasoningEffortOptions).includes(level)} onChange={e=>{const current=selectedReasoningEfforts(state.preferences.model,state.preferences.reasoningEffortOptions),next=e.target.checked?[...current,level]:current.filter(v=>v!==level);if(next.length<1||next.length>5){setError('选择 1–5 个档位');return}void preference({reasoningLevel:'auto',reasoningEffortOptions:{...state.preferences.reasoningEffortOptions,[state.preferences.model]:next}})}}/></label>)}</details>
      <label className="setting-row"><span>Fast 模式</span><input aria-label="Fast 模式" type="checkbox" checked={state.preferences.fastMode} disabled={busy||state.custom||state.preferences.billing==='free'||state.preferences.account==='ls'} onChange={e=>void preference({fastMode:e.target.checked})}/></label>
      <details><summary>上下文与压缩</summary><form onSubmit={e=>{e.preventDefault();const windows={...state.preferences.modelContextWindows},limits={...state.preferences.modelAutoCompactTokenLimits};if(context)windows[state.preferences.model]=Number(context);else delete windows[state.preferences.model];if(compact)limits[state.preferences.model]=Number(compact);else delete limits[state.preferences.model];void preference({modelContextWindows:windows,modelAutoCompactTokenLimits:limits})}}><label className="field">上下文 tokens<input aria-label="上下文 tokens" type="number" min={1024} max={100000000} placeholder="自动" value={context} onChange={e=>setContext(e.target.value)}/></label><label className="field">自动压缩阈值<input aria-label="自动压缩阈值" type="number" min={1024} max={100000000} placeholder="自动" value={compact} onChange={e=>setCompact(e.target.value)}/></label><button className="secondary-button" disabled={locked}>保存上下文</button></form><label className="setting-row"><span>允许更长上下文</span><input aria-label="允许更长上下文" type="checkbox" checked={longer} disabled={locked} onChange={e=>{const allowLongerContext=e.target.checked;void act(async()=>{const s=await rpc<any>('settings',{operation:'save',patch:{allowLongerContext},revision:settingsRevision});setSettingsRevision(s.revision);setLonger(s.allowLongerContext)})}}/></label><p className="muted">更长上下文可能增加请求费用。阈值按当前线路和模型分别保存。</p></details>
      </fieldset></details><button className="settings-link api-entry" onClick={()=>setCustom(!custom)}>使用自己的 API</button>
    </>:<div className="login-actions"><button className="primary-button" disabled={locked} onClick={()=>void act(async()=>{const result=await rpc<any>('account',{operation:'begin'});await refresh();await native('openUrl',{url:result.authUrl})})}>{state.pending?'重新登录':'登录 ModMind'}</button>{state.pending?<button className="text-button" onClick={()=>void native('openUrl',{url:state.pending.authUrl}).catch(e=>setError(message(e)))}>继续网页授权</button>:null}<button className="text-button" onClick={()=>setCustom(!custom)}>使用自己的 API</button></div>}
    {custom?<form onSubmit={e=>{e.preventDefault();void act(async()=>{await rpc('account',{operation:'configure',baseUrl,apiKey,model});setKey('');setCustom(false);cached=undefined;await refresh()})}}><label className="field">服务地址<input value={baseUrl} required type="url" placeholder="https://…/v1" onChange={e=>setBase(e.target.value)}/></label><label className="field">API Key<input value={apiKey} required type="password" autoComplete="off" onChange={e=>setKey(e.target.value)}/></label><label className="field">模型名称<input value={model} required onChange={e=>setModel(e.target.value)}/></label><button className="primary-button" disabled={locked}>连接 API</button></form>:null}
  </section>
}
