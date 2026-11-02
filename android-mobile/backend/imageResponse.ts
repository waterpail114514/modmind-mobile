import { createParser } from 'eventsource-parser'
import { networkFetch } from '../../src/main/networkRequest'

const max = 30 * 1024 * 1024
async function bounded(response: Response, limit = max) {
  if(Number(response.headers.get('content-length')||0)>limit){await response.body?.cancel();throw Error('图片响应超过容量限制')}
  const chunks:Buffer[]=[];let received=0
  for await(const value of response.body as any){received+=value.length;if(received>limit)throw Error('图片响应超过容量限制');chunks.push(Buffer.from(value))}
  return Buffer.concat(chunks)
}
/** Same completed-image semantics as desktop Image Studio, with a portable PNG codec. */
export async function mobileImageResponse(response:Response,signal:AbortSignal):Promise<Buffer> {
  const type=response.headers.get('content-type')||''
  if(type.startsWith('image/'))return bounded(response,20*1024*1024)
  let payload:any
  if(type.includes('text/event-stream')){
    let failure:Error|undefined,received=0
    const parser=createParser({onEvent(event){
      if(event.data.length>max){failure=Error('图片事件超过容量限制');return}
      if(event.data==='[DONE]')return
      try{
        const value=JSON.parse(event.data),kind=value.type||event.event||''
        if(value.error||kind==='error'||kind.endsWith('.failed'))throw Error('图片服务返回生成失败，请核对额度后再重试')
        if(kind.includes('partial')||value.partial_image_index!==undefined)return
        if(kind&&!kind.endsWith('.completed')&&kind!=='completed')return
        payload=value
      }catch(error){failure=error instanceof Error?error:Error('图片流格式无效')}
    }})
    const decoder=new TextDecoder()
    for await(const value of response.body as any){signal.throwIfAborted();received+=value.length;if(received>max*5)throw Error('图片流超过容量限制');parser.feed(decoder.decode(value,{stream:true}));if(failure)throw failure;if(payload){await response.body?.cancel().catch(()=>{});break}}
    parser.feed(decoder.decode());if(failure)throw failure
  }else payload=JSON.parse((await bounded(response)).toString('utf8'))
  const image=payload?.data?.[0]||payload
  const encoded=image?.b64_json
  if(typeof encoded==='string'){
    if(encoded.length>max||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('图片数据无效或超过容量限制')
    return Buffer.from(encoded,'base64')
  }
  if(typeof image?.url==='string'){
    if(/^data:image\/png;base64,/.test(image.url))return Buffer.from(image.url.split(',')[1],'base64')
    const url=new URL(image.url)
    if(url.protocol!=='https:'||url.username||url.password||/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[.*\])/.test(url.hostname))throw Error('图片下载地址无效')
    const download=await networkFetch(url.href,{signal,redirect:'error'})
    if(!download.ok)throw Error('图片已生成但下载失败，请保留记录并核对额度')
    return bounded(download,20*1024*1024)
  }
  throw Error('图片服务没有返回已完成的图片，请核对额度后再重试')
}
