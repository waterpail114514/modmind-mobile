import {replayWorkbenchEvents,replayLiveWorkbenchEvents,type WorkbenchTimelineItem} from '../../src/renderer/src/workbenchTimeline'
import type {ConversationEventRecord} from '../../src/shared/types'
import {mobileActivityLabel,mobileActivityKind} from '../shared/activity'
export function mergeMobileEvents(old:any[],next:any[]){const merged=new Map([...old,...next].map(e=>[e.eventId,e]));return [...merged.values()].sort((a,b)=>a.sequence-b.sequence).slice(-3100)}
export function mobileTimeline(events:any[],running:boolean):WorkbenchTimelineItem[]{
  const starts=new Map<string,string>()
  const normalized=events.filter(e=>!(e.payload?.kind==='warning'&&/Model metadata for|This session was recorded with model/.test(e.payload?.content||''))&&!(e.payload?.kind==='response'&&e.payload?.content==='本轮已完成'&&!e.payload?.itemId)).map(e=>{
    const p=e.payload,tool=p?.mobileTool
    if(e.kind==='user'&&typeof p?.prompt!=='string'&&typeof p?.content==='string')return {...e,payload:{...p,prompt:p.content}}
    if(!p||p.activity||p.kind!=='tool'||!tool)return e
    const id=tool.callId||e.eventId,key=e.turnId+':'+id;starts.set(key,starts.get(key)||e.time)
    return {...e,payload:{...p,content:mobileActivityLabel(tool.operation),itemId:id,streamId:key,activity:{kind:mobileActivityKind(tool.operation),title:mobileActivityLabel(tool.operation),tool:tool.tool,status:tool.status==='in_progress'?'running':tool.status==='failed'?'failed':'completed',startedAt:starts.get(key),...(tool.status!=='in_progress'?{completedAt:e.time}:{}),...(tool.path?{detail:tool.path}:{})}}}
  })
  return (running?replayLiveWorkbenchEvents:replayWorkbenchEvents)([],normalized as ConversationEventRecord[]).map(item=>item.activity?.status==='running'&&(!running||item.status!=='running')?{...item,status:'warning',activity:{...item.activity,status:'interrupted'}}:item)
}
