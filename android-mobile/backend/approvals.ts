import {randomUUID} from 'node:crypto'
export class MobileApprovals{
  private pending=new Map<string,{id:string;projectId:string;title:string;path?:string;resolve(v:boolean):void;timer:ReturnType<typeof setTimeout>}>()
  list(){return [...this.pending.values()].map(({resolve,timer,...publicValue})=>publicValue)}
  decide(id:string,allow:boolean){const value=this.pending.get(id);if(!value)throw Error('该操作已结束或过期');clearTimeout(value.timer);this.pending.delete(id);value.resolve(allow);return {decided:true}}
  async request(projectId:string,title:string,path?:string,signal?:AbortSignal){
    if(this.pending.size>=8)throw Error('待确认操作过多')
    signal?.throwIfAborted()
    const id=randomUUID();let abort:()=>void=()=>{}
    const allowed=await new Promise<boolean>(resolve=>{const finish=(value:boolean)=>{const entry=this.pending.get(id);if(entry)clearTimeout(entry.timer);this.pending.delete(id);signal?.removeEventListener('abort',abort);resolve(value)};const timer=setTimeout(()=>finish(false),110000);abort=()=>finish(false);this.pending.set(id,{id,projectId,title,...(path?{path:path.slice(0,512)}:{}),resolve:finish,timer});signal?.addEventListener('abort',abort,{once:true})})
    if(!allowed)throw Error('操作未获允许或确认已超时，项目未因本次请求发生修改')
  }
}
