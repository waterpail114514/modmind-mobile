import {spawn} from 'node:child_process'
import {StringDecoder} from 'node:string_decoder'
import path from 'node:path'
import {AgentActivityTracker} from '../../src/main/agentActivity'
import {codexApprovalPolicy} from '../../src/shared/agentApproval'
import {redactDiagnosticText} from '../../src/shared/redactDiagnosticText'
import type {AiOutputEvent} from '../../src/shared/types'
import type {AiActivity} from '../../src/shared/aiActivity'
import {waitForAgentTools,agentProbeResultReady} from '../../src/main/agentToolReadiness'
import {mobileActivityLabel,mobileActivityKind,mobileAsyncReceipt} from '../shared/activity'

type RecordValue=Record<string,any>
export interface MobileAppServerOptions {executable:string;env:Record<string,string>;cwd:string;config:RecordValue;model:string;sessionId?:string;prompt:string;signal:AbortSignal;output(kind:AiOutputEvent['kind'],content:string,extra?:RecordValue):Promise<unknown>;onSession(id:string):Promise<unknown>}
const configArgs=(value:RecordValue,prefix=''):string[]=>Object.entries(value).flatMap(([key,v])=>{const field=prefix?prefix+'.'+key:key;return v&&typeof v==='object'&&!Array.isArray(v)?configArgs(v,field):v===undefined||v===null?[]:['-c',field+'='+JSON.stringify(v)]})
const texts=(input:unknown)=>{let left=65536;return (Array.isArray(input)?input:[]).filter((v):v is string=>typeof v==='string').map(v=>{const result=v.slice(0,left);left-=result.length;return result}).filter(Boolean)}
export function toolMetadata(item:RecordValue):RecordValue|undefined{
  if(!['mcpToolCall','mcp_tool_call'].includes(item.type))return
  const args=item.arguments&&typeof item.arguments==='object'?item.arguments:{},operation=typeof args.operation==='string'?args.operation:''
  let result=item.result?.structured_content||item.result?.structuredContent
  if(!result)for(const block of item.result?.content||[])if(block.type==='text'){try{result=JSON.parse(block.text);break}catch{}}
  return {callId:item.id,tool:item.tool,operation,status:item.status,
    ...(typeof args.path==='string'?{path:args.path.slice(0,512)}:{}),...(typeof args.imageId==='string'?{imageId:args.imageId}:{}),
    ...(operation==='image_draft'&&typeof args.prompt==='string'?{prompt:args.prompt.slice(0,20000)}:{}),
    ...(result?.id&&item.tool==='modmind_mobile_task'&&!result.title?{taskId:result.id}:{}),
    ...(result?.id&&result.title&&result.status&&['check','archive','snapshot','restore_snapshot'].includes(operation)?{jobId:result.id}:{}),
    ...(result?.id&&operation==='export'?{artifact:{id:result.id,name:result.name,size:result.size,sha256:result.sha256}}:{})}
}

/** Android transport for the same native protocol used by desktop externalAgents.
 * Business tools, activity classification and timeline reducers remain shared. */
export async function runMobileAppServer(options:MobileAppServerOptions){
  const child=spawn(options.executable,[...configArgs(options.config),'app-server','--listen','stdio://'],{cwd:options.cwd,env:options.env,detached:process.platform!=='win32',windowsHide:true,stdio:['pipe','pipe','pipe']})
  const pending=new Map<number,{method:string;resolve(v:any):void;reject(e:Error):void;timer:ReturnType<typeof setTimeout>}>(),delayed:RecordValue[]=[]
  let sequence=0,threadId=options.sessionId||'',turnId='',submitted=false,closed=false,buffer='',stderr='',tail=Promise.resolve(),queuedBytes=0,planStartedAt=''
  const presentations=new Map<string,{tool?:string;operation:string;path?:string;metadata?:RecordValue}>()
  let finish!:(v:void)=>void,fail!:(e:Error)=>void
  const done=new Promise<void>((resolve,reject)=>{finish=resolve;fail=reject});void done.catch(()=>{})
  const replies=new Map<string,{text:string;phase?:string}>(),identity=new Set(['thread/start','thread/resume','turn/start'])
  const send=(v:unknown)=>{if(closed||child.stdin.destroyed)throw Error('本地 AI 过程通道已关闭');child.stdin.write(JSON.stringify(v)+'\n')}
  const request=(method:string,params:RecordValue,timeout=30000)=>new Promise<any>((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('本地 AI '+method+' 回执超时'))},timeout);pending.set(id,{method,resolve,reject,timer});try{send({id,method,params})}catch(e){clearTimeout(timer);pending.delete(id);reject(e)}})
  const out=(kind:AiOutputEvent['kind'],text:string,itemId?:string,extra:RecordValue={})=>options.output(kind,text.slice(0,65536),{...(itemId?{itemId,streamId:threadId+':'+turnId+':'+itemId}:{}),...extra})
  const activityWrites:Promise<unknown>[]=[]
  const activities=new AgentActivityTracker((id,activity)=>{
    const presentation=presentations.get(id),op=presentation?.operation||''
    const relativeFiles=activity.files?.map(f=>path.isAbsolute(f.path)?{...f,path:path.relative(options.cwd,f.path).replaceAll('\\','/')}:f)
    const value:AiActivity={...activity,...(relativeFiles?{files:relativeFiles}:{}),...(presentation?.tool?.startsWith('modmind_mobile_')?{kind:mobileActivityKind(op),title:mobileActivityLabel(op),...(presentation.path&&mobileActivityKind(op)==='file'?{files:[{path:presentation.path,operation:op==='remove_file'?'delete':op==='model_create'?'create':'edit'}]}:{})}:{})}
    const presented=mobileAsyncReceipt(value,op,presentation?.metadata)
    activityWrites.push(out('tool',presented.title,id,{activity:presented,...(presentation?.metadata?{mobileTool:presentation.metadata}:{})}))
  })
  const handle=async(message:RecordValue)=>{
    const method=message.method,p=message.params||{}
    if(p.threadId&&p.threadId!==threadId)return
    if(turnId&&p.turnId&&p.turnId!==turnId)return
    if(method==='item/started'||method==='item/completed'){
      const item=p.item;if(!item||typeof item.id!=='string')return
      const args=item.arguments||{},completed=method==='item/completed'
      if(presentations.size>=512&&!presentations.has(item.id))presentations.delete(presentations.keys().next().value!)
      presentations.set(item.id,{tool:item.tool,operation:typeof args.operation==='string'?args.operation:'',...(typeof args.path==='string'?{path:args.path.slice(0,512)}:{}),metadata:toolMetadata(item)})
      activities.item(item,completed);await Promise.all(activityWrites.splice(0))
      if(item.type==='reasoning')await out('reasoning','',item.id,{reasoning:completed?{phase:'completed',summary:texts(item.summary),text:texts(item.content)}:{phase:'start'}})
      if(item.type==='agentMessage'||item.type==='plan'){
        if(!completed)await out('stream-start','',item.id)
        else if(typeof item.text==='string'){const phase=item.phase==='commentary'||item.delivery==='async'?'commentary':item.phase==='final_answer'||item.type==='plan'?'final_answer':undefined;replies.set(item.id,{text:item.text,phase});await out('response',item.text,item.id)}
      }
    }else if(method==='item/agentMessage/delta'&&typeof p.delta==='string')await out('delta',p.delta,p.itemId)
    else if(['item/commandExecution/outputDelta','item/fileChange/outputDelta'].includes(method)){activities.output(p.itemId,p.delta);await Promise.all(activityWrites.splice(0))}
    else if(method==='item/mcpToolCall/progress'&&typeof p.message==='string'){activities.output(p.itemId,p.message+'\n',true);await Promise.all(activityWrites.splice(0))}
    else if(['item/reasoning/summaryTextDelta','item/reasoning/textDelta'].includes(method)&&typeof p.delta==='string'){
      const summary=method==='item/reasoning/summaryTextDelta',index=summary?p.summaryIndex:p.contentIndex
      if(Number.isSafeInteger(index)&&index>=0&&index<256)await out('reasoning',p.delta,p.itemId,{reasoning:{phase:'delta',channel:summary?'summary':'text',index}})
    }else if(method==='turn/plan/updated'&&Array.isArray(p.plan)){
      const plan=p.plan.slice(0,50),count=plan.filter((step:RecordValue)=>step.status==='completed').length
      const complete=plan.length>0&&count===plan.length;planStartedAt||=new Date().toISOString()
      await out('tool','更新任务清单','plan',{activity:{kind:'tool',title:'更新任务清单',status:complete?'completed':'running',startedAt:planStartedAt,...(complete?{completedAt:new Date().toISOString()}:{}),progress:{current:count,total:plan.length},detail:count+' / '+plan.length+' 项已完成',output:plan.map((step:RecordValue)=>(step.status==='completed'?'✓ ':'○ ')+String(step.step||'').slice(0,500)).join('\n')}})
    }else if(method==='thread/tokenUsage/updated'&&p.tokenUsage){
      const usage=p.tokenUsage,last=usage.last||{};await out('usage','',undefined,{usage:{model:options.model,backend:'codex',inputTokens:last.inputTokens,cachedInputTokens:last.cachedInputTokens,outputTokens:last.outputTokens,contextWindow:usage.modelContextWindow,contextTokens:last.inputTokens}})
    }else if(method==='thread/compacted')await out('tool','上下文已自动压缩','compaction:'+Date.now())
    else if(method==='error'||method==='warning'){
      const text=redactDiagnosticText(String(p.error?.message||p.message||'本地 AI 返回异常'))
      if(method==='warning')await out('warning',text,undefined,{terminal:false,recoverable:true})
      else if(p.willRetry)await out('retry',/429/.test(text)?'模型线路繁忙，正在等待重试':'连接中断，正在重试',undefined,{terminal:false,recoverable:true})
      else fail(Error(text))
    }else if(method==='turn/completed'){
      if(p.turn?.status==='failed')return fail(Error(p.turn.error?.message||'模型本轮未完成'))
      if(p.turn?.status==='interrupted')return fail(Error('本轮已停止'))
      if(p.turn?.status!=='completed')return
      const final=[...replies].reverse().find(([,r])=>r.phase==='final_answer')||[...replies].reverse().find(([,r])=>r.phase!=='commentary')
      if(final)await out('answer',final[1].text,final[0],{terminal:true});else await out('warning','本轮没有收到最终正文，过程与已完成操作仍保留。',undefined,{terminal:true,recoverable:true})
      finish()
    }
  }
  const consume=(value:RecordValue)=>{
    if(value.id!==undefined&&!value.method){const waiter=pending.get(Number(value.id));if(!waiter)return;pending.delete(Number(value.id));clearTimeout(waiter.timer);if(value.error)waiter.reject(Error(value.error.message||'本地 AI 请求失败'));else{if(['thread/start','thread/resume'].includes(waiter.method)&&value.result?.thread?.id)threadId=value.result.thread.id;if(waiter.method==='turn/start'&&value.result?.turn?.id)turnId=value.result.turn.id;waiter.resolve(value.result)}if(identity.has(waiter.method))for(const n of delayed.splice(0))consume(n);return}
    if(value.id!==undefined&&value.method){send({id:value.id,error:{code:-32601,message:'手机仅开放已授权的 ModMind MCP 操作'}});return}
    if([...pending.values()].some(p=>identity.has(p.method))){if(delayed.length>=1024)return fail(Error('本地 AI 通知积压'));delayed.push(value);return}
    const bytes=Buffer.byteLength(JSON.stringify(value));queuedBytes+=bytes
    if(queuedBytes>8*1024*1024){fail(Error('本地 AI 过程更新积压，请停止后重试'));return}
    tail=tail.then(()=>handle(value)).finally(()=>{queuedBytes-=bytes});void tail.catch(fail)
  }
  const decoder=new StringDecoder('utf8')
  child.stdout.on('data',(chunk:Buffer)=>{buffer+=decoder.write(chunk);if(buffer.length>32*1024*1024){fail(Error('本地 AI 单条结果超过手机容量'));return}const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines)if(line.trim())try{consume(JSON.parse(line))}catch{fail(Error('本地 AI 过程数据格式无效'))}})
  child.stderr.on('data',(b:Buffer)=>{stderr=(stderr+b.toString('utf8')).slice(-8000)})
  child.stdin.on('error',e=>fail(e))
  child.once('error',e=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(e)}pending.clear();fail(e)})
  child.once('close',()=>{closed=true;const error=Error('本地 AI 已退出'+(stderr?'：'+redactDiagnosticText(stderr).slice(-1000):''));for(const p of pending.values()){clearTimeout(p.timer);p.reject(error)}pending.clear();void tail.then(()=>fail(error)).catch(fail)})
  const stop=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGTERM');else child.kill()}catch{child.kill()}}
  const abort=()=>{if(threadId&&turnId)void request('turn/interrupt',{threadId,turnId},3000).catch(()=>{});fail(options.signal.reason instanceof Error?options.signal.reason:Error('已停止'));setTimeout(stop,500).unref()}
  options.signal.addEventListener('abort',abort,{once:true})
  try{
    options.signal.throwIfAborted();await request('initialize',{clientInfo:{name:'modmind_mobile',title:'ModMind',version:'0.4.0'},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}})
    const common={cwd:options.cwd,runtimeWorkspaceRoots:[options.cwd],...codexApprovalPolicy(true),model:options.model,modelProvider:'mobile',developerInstructions:options.config.developer_instructions}
    await request(options.sessionId?'thread/resume':'thread/start',options.sessionId?{...common,threadId:options.sessionId,excludeTurns:true}:common)
    if(!threadId)throw Error('本地 AI 未返回会话标识');await options.onSession(threadId)
    await waitForAgentTools({signal:options.signal,timeoutMs:20000,requiredTools:['modmind_mobile_query','modmind_mobile_studio'],list:cursor=>request('mcpServerStatus/list',{threadId,limit:100,...(cursor?{cursor}:{})})})
    const probe=await request('mcpServer/tool/call',{threadId,server:'modmind',tool:'modmind_mcp_probe',arguments:{}})
    if(!agentProbeResultReady(probe))throw Error('项目工具探针未通过，本轮未发起模型请求')
    submitted=true;await request('turn/start',{threadId,input:[{type:'text',text:options.prompt,text_elements:[]}],model:options.model});await done;await tail
  }catch(error){throw Object.assign(error instanceof Error?error:Error(String(error)),{beforeModel:!submitted})}
  finally{options.signal.removeEventListener('abort',abort);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('本地 AI 通道已结束'))}pending.clear();try{child.stdin.end()}catch{}if(!closed){const timer=setTimeout(stop,1000);timer.unref()}}
}
