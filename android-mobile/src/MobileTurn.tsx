import {lazy,Suspense,useState} from 'react'
import {Check,Copy} from 'lucide-react'
import AgentActivityList from '../../src/renderer/src/components/AgentActivityList'
import AgentReasoningView from '../../src/renderer/src/components/AgentReasoningView'
import type {WorkbenchTimelineItem} from '../../src/renderer/src/workbenchTimeline'
import Reply from './Reply'
import type {Project} from './types'
const ToolResult=lazy(()=>import('./ToolResult'))

export default function MobileTurn({items,events,project,readOnly,running,onFile,onModel,onAction,onRetry,expandReasoning}:{items:WorkbenchTimelineItem[];events:any[];expandReasoning?:boolean;project:Project;readOnly:boolean;running:boolean;onFile(path:string):void;onModel(path:string):void;onAction(kind:'files'|'tasks'):void;onRetry(text:string):void}){
  const [copied,setCopied]=useState(''),[copyError,setCopyError]=useState('')
  const blocks:Array<{kind:'activity';items:WorkbenchTimelineItem[]}|{kind:'message';item:WorkbenchTimelineItem}>=[]
  for(const item of items){if(['tool','thinking','status','start','retry'].includes(item.kind)){const previous=blocks.at(-1);if(previous?.kind==='activity')previous.items.push(item);else blocks.push({kind:'activity',items:[item]})}else blocks.push({kind:'message',item})}
  const lastTools=new Map<string,any>();for(const event of events)if(event.payload?.mobileTool)lastTools.set(event.payload.mobileTool.callId,event)
  const used=new Set<string>()
  const cards=(block:WorkbenchTimelineItem[])=>[...lastTools.values()].filter(event=>{const t=event.payload.mobileTool;if(used.has(event.eventId)||t.status!=='completed'||!block.some(item=>item.itemId===t.callId||item.eventId===event.eventId))return false;used.add(event.eventId);return true}).map(event=><Suspense key={event.eventId} fallback={<div className="result-placeholder"/>}><ToolResult event={event} project={project} readOnly={readOnly} onFile={onFile} onModel={onModel} onAction={onAction}/></Suspense>)
  const user=items.find(item=>item.kind==='user')
  return <div className="chat-turn">{blocks.map((block,i)=>block.kind==='activity'?<div key={'activity:'+i}><AgentActivityList items={block.items} onOpenFile={onFile}/>{cards(block.items)}</div>:block.item.kind==='user'?<div className="user-message" key={block.item.id}>{block.item.content}</div>:block.item.kind==='reasoning'?<AgentReasoningView key={block.item.id} reasoning={block.item.reasoning} running={running&&block.item.status==='running'} expandWhileRunning={expandReasoning} renderContent={text=><Reply text={text} onFile={onFile}/>}/>:['answer','response'].includes(block.item.kind)?<div className={'assistant-message'+(block.item.kind==='answer'?' final-message':'')} key={block.item.id}><Reply text={block.item.content} onFile={onFile}/>{block.item.content?<button className="copy-reply" aria-label="复制回复" onClick={()=>{void navigator.clipboard.writeText(block.item.content).then(()=>{setCopied(block.item.id);setTimeout(()=>setCopied(''),1800)}).catch(()=>setCopyError('复制失败，请长按选择文字'))}}>{copied===block.item.id?<Check size={15}/>:<Copy size={15}/>}</button>:null}</div>:['warning','error'].includes(block.item.kind)?<div className={block.item.kind==='error'?'reply-error':'reply-error reply-notice'} role={block.item.kind==='error'?'alert':'status'} key={block.item.id}>{block.item.content}{block.item.kind==='error'?<button className="text-button" onClick={()=>onRetry(user?.content||'')}>重试这条消息</button>:null}</div>:null)}{copyError?<p className="inline-error">{copyError}</p>:null}</div>
}
