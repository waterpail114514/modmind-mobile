import type {AiOutputEvent} from '../../src/shared/types'
type Extra=Record<string,any>
type Write=(kind:AiOutputEvent['kind'],text:string,extra?:Extra)=>Promise<unknown>
/** Persist token deltas in short batches, preserving boundaries and indexed reasoning. */
export class MobileOutputBuffer{
  private pending?:{kind:AiOutputEvent['kind'];text:string;extra:Extra;key:string}
  private timer?:ReturnType<typeof setTimeout>
  private tail:Promise<unknown>=Promise.resolve()
  private error?:Error
  private count=0
  private bytes=0
  constructor(private write:Write,private abort:(error:Error)=>void,private limit=1000){}
  private enqueue(kind:AiOutputEvent['kind'],text:string,extra:Extra){
    this.tail=this.tail.then(async()=>{
      if(this.error)throw this.error
      this.count++;this.bytes+=Buffer.byteLength(JSON.stringify({kind,text,extra}))
      if(this.count>this.limit||this.bytes>4*1024*1024)throw Error('本轮过程记录已达到手机容量限制，已停止。已有操作与记录已保留，请新建对话继续。')
      return this.write(kind,text,extra)
    }).catch(error=>{this.error=error instanceof Error?error:Error(String(error));this.abort(this.error);throw this.error})
    void this.tail.catch(()=>{})
    return this.tail
  }
  flush(){
    clearTimeout(this.timer);this.timer=undefined
    const value=this.pending;this.pending=undefined
    return value?this.enqueue(value.kind,value.text,value.extra):this.tail
  }
  async output(kind:AiOutputEvent['kind'],text:string,extra:Extra={}){
    if(this.error)throw this.error
    const delta=kind==='delta'||kind==='reasoning'&&extra.reasoning?.phase==='delta'
    if(!delta){await this.flush();return this.enqueue(kind,text,extra)}
    const key=[kind,extra.itemId,extra.streamId,extra.reasoning?.channel,extra.reasoning?.index].join(':')
    if(this.pending&&(this.pending.key!==key||this.pending.text.length+text.length>8192))await this.flush()
    if(!this.pending)this.pending={kind,text:'',extra,key}
    this.pending.text+=text
    if(!this.timer){this.timer=setTimeout(()=>{void this.flush().catch(()=>{})},160);this.timer.unref()}
  }
}
