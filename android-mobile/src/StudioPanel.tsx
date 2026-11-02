import {AnimatePresence,motion} from 'motion/react'
import {useMobileMotion,mobileEase} from './motion'
import { useEffect, useRef, useState, useMemo } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, FolderOpen, History, ListChecks, Menu, Plus, Square, SquarePen, StickyNote, X } from 'lucide-react'
import { rpc } from './bridge'
import type { Project } from './types'
import Sheet from './Sheet'
import { quotaModelMetadata } from '../../src/shared/quotaModels'
import MobileTurn from './MobileTurn'
import {mobileTimeline,mergeMobileEvents} from './mobileTimeline'
import type {MobilePreferences} from '../shared/settings'
import {native} from './bridge'
import modmindLogo from '../../src/renderer/src/assets/logo.png'
const message=(e:unknown)=>e instanceof Error?e.message:String(e)
type Surface='workspace'|'inspiration'
type Props={preferences:MobilePreferences;project:Project;surface:Surface;onSurface(value:Surface):void;onProjects():void;onAccount():void;onAction(kind:'files'|'tasks'|'notes'):void;onFile(path:string):void;onModel(path:string):void;accountRevision:number}
const toolLabel=(event:any)=>{
  const tool=event.payload?.mobileTool,operation=tool?.operation||''
  if(!tool){const text=event.payload?.content||'';return /mobile_write/.test(text)?'更新项目':/mobile_task/.test(text)?'构建项目':'读取项目'}
  return ({read:'读取文件',files:'查看项目',project:'查看项目',save:'保存文件',build:'构建模组',export:'导出整合包',image_draft:'准备图片',model_create:'制作模型',model_preview:'查看模型',note_save:'保存知识',notes:'读取知识',image:'查看图片',images:'读取图片',tasks:'检查构建',check:'检查项目',test:'运行项目测试',archive:'归档项目',snapshot:'创建恢复点',restore_snapshot:'恢复文件'} as Record<string,string>)[operation]||'处理项目'
}
export default function StudioPanel({preferences,project,surface,onSurface,onProjects,onAccount,onAction,onFile,onModel,accountRevision}:Props){
  const [conversations,setConversations]=useState<any[]>([]),[selected,setSelected]=useState(''),[events,setEvents]=useState<any[]>([]),[running,setRunning]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[next,setNext]=useState<number|null>(null)
  const [history,setHistory]=useState(false),[actions,setActions]=useState(false),[search,setSearch]=useState(''),[account,setAccount]=useState<any>(),[more,setMore]=useState(false),[loading,setLoading]=useState(true)
  const [approvals,setApprovals]=useState<any[]>([]),wasRunning=useRef(false)
  useEffect(()=>{if(wasRunning.current&&!running&&preferences.notificationsEnabled)void native('notify',{title:'ModMind',message:'AI 任务已结束，请查看对话结果'}).catch(()=>{});wasRunning.current=running},[running])
  useEffect(()=>{if(!running){setApprovals([]);return}let active=true;const poll=()=>{void rpc<any>('settings',{operation:'approvals'}).then(v=>{if(active)setApprovals(v.pending.filter((p:any)=>p.projectId===project.id))}).catch(()=>{})};poll();const timer=setInterval(poll,800);return()=>{active=false;clearInterval(timer)}},[running,project.id])
  const draftKey=project.id+':'+surface
  const [text,setText]=useState(()=>{try{return JSON.parse(localStorage.getItem('modmind.mobile.messages')||'[]').find((v:any)=>v.key===draftKey)?.text||''}catch{return ''}})
  const cursor=useRef(0),scroll=useRef<HTMLDivElement>(null),sticky=useRef(true),input=useRef<HTMLTextAreaElement>(null),owner=useRef(0),selection=useRef(selected),initial=useRef(true)
  selection.current=selected
  const refreshList=async()=>{const r=await rpc<any>('ai',{operation:'list',projectId:project.id,surface});setConversations(r.conversations);return r.conversations}
  useEffect(()=>{let active=true;void rpc('account',{operation:'status',scope:surface}).then(value=>{if(active)setAccount(value)}).catch(()=>{});return()=>{active=false}},[accountRevision])
  useEffect(()=>{const mark=++owner.current;setLoading(true);void refreshList().then(list=>{if(mark!==owner.current)return;let stored='';try{stored=JSON.parse(localStorage.getItem('modmind.mobile.active')||'[]').find((v:any)=>v.key===draftKey)?.id||''}catch{};if(initial.current)setSelected(list.some((c:any)=>c.id===stored)?stored:'');initial.current=false;setLoading(false)}).catch(e=>{setError(message(e));setLoading(false)});return()=>{owner.current++}},[draftKey])
  useEffect(()=>{try{const old=JSON.parse(localStorage.getItem('modmind.mobile.active')||'[]').filter((v:any)=>v.key!==draftKey);if(!loading)localStorage.setItem('modmind.mobile.active',JSON.stringify([{key:draftKey,id:selected},...old].slice(0,16)))}catch{}},[selected,draftKey,loading])
  useEffect(()=>{try{const old=JSON.parse(localStorage.getItem('modmind.mobile.messages')||'[]').filter((v:any)=>v.key!==draftKey&&v.at>Date.now()-7*86400000);localStorage.setItem('modmind.mobile.messages',JSON.stringify((text?[{key:draftKey,text,at:Date.now()},...old]:old).slice(0,8)))}catch{}},[draftKey,text])
  useEffect(()=>{const el=input.current;if(el){el.style.height='0px';el.style.height=Math.max(48,Math.min(el.scrollHeight,150))+'px'}},[text])
  useEffect(()=>{
    cursor.current=0;sticky.current=true;setEvents([]);setNext(null);setRunning(false)
    if(!selected)return
    let active=true,timer:ReturnType<typeof setTimeout>
    const poll=async()=>{try{const r=await rpc<any>('ai',{operation:'read',projectId:project.id,conversationId:selected,afterSequence:cursor.current});if(!active)return;setRunning(r.running);if(r.events.length)setEvents(old=>mergeMobileEvents(old,r.events));cursor.current=r.events.at(-1)?.sequence||cursor.current;setNext(r.nextSequence);timer=setTimeout(poll,r.nextSequence!==null?60:r.running?450:4000)}catch(e){if(active){setError(message(e));timer=setTimeout(poll,4000)}}}
    void poll();return()=>{active=false;clearTimeout(timer)}
  },[selected,project.id])
  useEffect(()=>{if(sticky.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;else if(events.length)setMore(true)},[events,running])
  const send=async()=>{
    if(!text.trim()||busy||running)return
    const content=text;setBusy(true);setError('')
    try{
      const conversation=selected?{id:selected}:await rpc<any>('ai',{operation:'create',projectId:project.id,surface})
      await rpc('ai',{operation:'send',projectId:project.id,conversationId:conversation.id,content})
      sticky.current=true;setText('');setSelected(conversation.id);setRunning(true);await refreshList()
      if(selected===conversation.id){const r=await rpc<any>('ai',{operation:'read',projectId:project.id,conversationId:selected,afterSequence:cursor.current});cursor.current=r.events.at(-1)?.sequence||cursor.current;setEvents(old=>mergeMobileEvents(old,r.events))}
    }catch(e){setError(message(e))}finally{setBusy(false)}
  }
  const timeline=useMemo(()=>mobileTimeline(events,running),[events,running])
  const turnIds=[...new Set(timeline.map(e=>e.turnId).filter(Boolean))]
  const reset=()=>{initial.current=false;setSelected('');setEvents([]);setError('');sticky.current=true;setHistory(false);setText('')}
  const {reduce,keyboard}=useMobileMotion()
  return <motion.section className="chat-shell" initial={{opacity:keyboard?1:.6,transform:reduce||keyboard?'none':'translateY(4px)'}} animate={{opacity:1,transform:'none'}} transition={{duration:keyboard?0:.15,ease:mobileEase}}>
    <header className="chat-header"><button className="icon-button" aria-label="切换项目" onClick={onProjects}><Menu size={21}/></button><button className="chat-title" aria-label="当前项目" onClick={onProjects}><span>{project.name}</span><ChevronDown size={14}/></button><button className="icon-button" aria-label="对话历史" onClick={()=>{setHistory(true);void refreshList().catch(e=>setError(message(e)))}}><History size={20}/></button><button className="icon-button" aria-label="新建对话" onClick={reset}><SquarePen size={20}/></button></header>
    <nav className="surface-switch" aria-label="对话模式">{([['workspace','工作台'],['inspiration','灵感台']] as const).map(([value,label])=><button key={value} aria-pressed={surface===value} onClick={()=>onSurface(value)}>{label}</button>)}</nav>
    <div className="conversation" ref={scroll} onScroll={()=>{const el=scroll.current!;sticky.current=el.scrollHeight-el.scrollTop-el.clientHeight<90;if(sticky.current)setMore(false)}}>
      {!turnIds.length?<div className="chat-empty"><img className="empty-logo" src={modmindLogo} alt="ModMind" width={56} height={56}/><h1>{surface==='inspiration'?'有什么新想法？':'今天想做点什么？'}</h1></div>:turnIds.map(turnId=>{
        const items=timeline.filter(e=>e.turnId===turnId),raw=events.filter(e=>e.turnId===turnId)
        return <MobileTurn key={turnId} items={items} events={raw} project={project} readOnly={surface==='inspiration'} running={running&&turnId===turnIds.at(-1)} onFile={onFile} onModel={onModel} onAction={onAction} expandReasoning={preferences.reasoningExpanded} onRetry={value=>{setText(value);input.current?.focus()}}/>
      })}
      {next!==null?<div className="loading-row" role="status">正在载入记录</div>:null}
      {running?<div className="working-status" role="status"><span className="activity-dot"/><span>{events.at(-1)?.payload?.kind==='tool'?toolLabel(events.at(-1)):'正在思考'}</span></div>:null}
    </div>
    {approvals.map(a=><div className="inline-result approval-card" key={a.id}><strong>允许 {a.title}？</strong>{a.path?<p>{a.path}</p>:null}<div className="action-row"><button className="secondary-button" onClick={()=>void rpc('settings',{operation:'decide',id:a.id,allow:false}).catch(e=>setError(message(e)))}>拒绝</button><button className="primary-button" onClick={()=>void rpc('settings',{operation:'decide',id:a.id,allow:true}).catch(e=>setError(message(e)))}>允许本次</button></div></div>)}
    {more?<button className="jump-latest icon-button" aria-label="回到最新消息" onClick={()=>{sticky.current=true;setMore(false);if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight}}><ArrowDown size={18}/></button>:null}
    {error?<div className="composer-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误" onClick={()=>setError('')}><X size={16}/></button></div>:null}
    <form className="composer" onSubmit={e=>{e.preventDefault();void send()}}><textarea ref={input} rows={1} aria-label="AI 消息" value={text} maxLength={20000} placeholder={surface==='inspiration'?'聊聊你的想法':'描述你想制作的内容'} onChange={e=>setText(e.target.value)}/><div className="composer-bottom"><button type="button" className="icon-button" aria-label="添加项目内容" onClick={()=>setActions(true)}><Plus size={22}/></button><button type="button" className="model-choice" aria-label="选择 AI 模型" onClick={onAccount}><span>{account?.connected?(account.preferences.model?quotaModelMetadata(account.preferences.model).name:'选择模型'):'登录账号'}</span><ChevronDown size={12}/></button>{running?<button type="button" className="send-button" aria-label="停止 AI" onClick={()=>{void rpc('ai',{operation:'cancel',projectId:project.id,conversationId:selected}).catch(e=>setError(message(e)))}}><Square size={17} fill="currentColor"/></button>:<button className="send-button" aria-label="发送消息" disabled={busy||!text.trim()||loading}><ArrowUp size={22}/></button>}</div></form>
    <AnimatePresence>{history?<Sheet key="history" title="对话" close={()=>setHistory(false)} className="history-sheet"><div className="panel-scroll"><input className="history-search" aria-label="搜索对话" value={search} placeholder="搜索对话" onChange={e=>setSearch(e.target.value)}/><button className="history-row" onClick={reset}><SquarePen size={18}/><span>新建对话</span></button>{conversations.filter(c=>c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(c=><button className="history-row" aria-pressed={selected===c.id} key={c.id} onClick={()=>{initial.current=false;setSelected(c.id);setHistory(false);setError('')}}><span>{c.title}</span>{selected===c.id?<Check size={16}/>:null}</button>)}{!conversations.some(c=>c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))?<p className="muted">{search?'没有匹配对话':'还没有对话'}</p>:null}</div></Sheet>:null}
    {actions?<Sheet key="actions" title={surface==='inspiration'?'加入讨论':'制作当前项目'} close={()=>setActions(false)} className="actions-sheet"><div className="action-options"><button onClick={()=>{setActions(false);onAction('files')}}><FolderOpen size={21}/><span>项目文件</span></button>{surface==='workspace'?<button onClick={()=>{setActions(false);onAction('tasks')}}><ListChecks size={21}/><span>{project.kind==='mod'?'构建记录':'导出整合包'}</span></button>:null}<button onClick={()=>{setActions(false);onAction('notes')}}><StickyNote size={21}/><span>项目知识</span></button></div></Sheet>:null}
  </AnimatePresence></motion.section>
}
