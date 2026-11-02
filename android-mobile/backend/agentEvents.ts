import {AgentActivityTracker} from '../../src/main/agentActivity'
import type {AiActivity} from '../../src/shared/aiActivity'
import type {AiOutputEvent,AiReasoningUpdate} from '../../src/shared/types'
import type {ThreadEvent,ThreadItem} from '@openai/codex-sdk'
import {mobileActivityKind,mobileActivityLabel,mobileAsyncReceipt} from '../shared/activity'

type Output=(kind:AiOutputEvent['kind'],content:string,extra?:Record<string,unknown>)=>Promise<unknown>
export class MobileAgentEvents {
  private tracker:AgentActivityTracker
  private queued:Promise<unknown>[]=[]
  private activeItem?:ThreadItem
  private metadata?:Record<string,unknown>
  private messages=new Map<string,{text:string;phase?:string}>()
  private reasoning=new Map<string,string>()
  constructor(private output:Output,private prefix:string){
    this.tracker=new AgentActivityTracker((id,activity)=>{
      const item=this.activeItem,args=item?.type==='mcp_tool_call'?item.arguments as Record<string,unknown>:undefined,op=typeof args?.operation==='string'?args.operation:''
      const mapped:AiActivity=item?.type==='mcp_tool_call'&&item.tool.startsWith('modmind_mobile_')?{...activity,kind:mobileActivityKind(op),title:mobileActivityLabel(op),...(typeof args?.path==='string'&&['save','restore','move','remove_file','model_create','image_apply'].includes(op)?{files:[{path:args.path,operation:op==='model_create'?'create':op==='remove_file'?'delete':'edit'}]}:{})}:activity
      const presented=mobileAsyncReceipt(mapped,op,this.metadata)
      this.queued.push(this.output('tool',presented.title,{activity:presented,itemId:id,streamId:this.prefix+':'+id,...(this.metadata?{mobileTool:this.metadata}:{})}))
    })
  }
  private async flush(){await Promise.all(this.queued.splice(0))}
  private identity(id:string){return {itemId:id,streamId:this.prefix+':'+id}}
  async item(event:Extract<ThreadEvent,{type:'item.started'|'item.updated'|'item.completed'}>,metadata?:Record<string,unknown>){
    const item=event.item,completed=event.type==='item.completed';this.activeItem=item;this.metadata=metadata
    if(item.type==='agent_message'){
      const previous=this.messages.get(item.id),phase=(item as unknown as {phase?:string}).phase
      if(!previous)await this.output('stream-start','',this.identity(item.id))
      if(item.text!==previous?.text&&(!previous||item.text.startsWith(previous.text))){const delta=previous?item.text.slice(previous.text.length):item.text;await this.output('delta',delta,this.identity(item.id))}
      this.messages.set(item.id,{text:item.text,phase})
      if(completed)await this.output('response',item.text,this.identity(item.id))
    }else if(item.type==='reasoning'){
      const previous=this.reasoning.get(item.id)
      if(previous===undefined)await this.output('reasoning','',{...this.identity(item.id),reasoning:{phase:'start'} satisfies AiReasoningUpdate})
      if(item.text&&item.text!==previous&&(previous===undefined||item.text.startsWith(previous))){const delta=previous?item.text.slice(previous.length):item.text;await this.output('reasoning',delta,{...this.identity(item.id),reasoning:{phase:'delta',channel:'summary',index:0} satisfies AiReasoningUpdate})}
      this.reasoning.set(item.id,item.text)
      if(completed)await this.output('reasoning','',{...this.identity(item.id),reasoning:{phase:'completed',summary:item.text?[item.text]:[],text:[]} satisfies AiReasoningUpdate})
    }else if(item.type==='todo_list'){
      const done=item.items.filter(i=>i.completed).length,activity:AiActivity={kind:'tool',title:'更新任务清单',status:completed?'completed':'running',startedAt:new Date().toISOString(),progress:{current:done,total:item.items.length},detail:done+' / '+item.items.length+' 项已完成',output:item.items.slice(0,50).map(i=>(i.completed?'✓ ':'○ ')+i.text).join('\n').slice(0,12000)}
      await this.output('tool',activity.title,{...this.identity(item.id),activity})
    }else if(item.type==='error')await this.output('warning',item.message,{...this.identity(item.id),terminal:false,recoverable:true})
    else{
      const types:Record<string,string>={mcp_tool_call:'mcpToolCall',command_execution:'commandExecution',file_change:'fileChange',web_search:'webSearch'}
      const normalized={...item,type:types[item.type]||item.type,...(item.type==='command_execution'?{aggregatedOutput:item.aggregated_output,exitCode:item.exit_code}:{})}
      this.tracker.item(normalized,completed);await this.flush()
    }
  }
  async supplementReasoning(id:string,summary:string[],text:string[]){await this.output('reasoning','',{...this.identity(id),reasoning:{phase:'completed',summary,text} satisfies AiReasoningUpdate})}
  reasoningEntries(){return [...this.reasoning]}
  async complete(){await this.flush();const last=[...this.messages].reverse().find(([,m])=>m.text.trim()&&m.phase!=='commentary');if(last)await this.output('answer',last[1].text,{...this.identity(last[0]),terminal:true});else await this.output('warning','本轮没有收到最终正文，已有过程和操作记录已保留。',{terminal:true,recoverable:true})}
}
