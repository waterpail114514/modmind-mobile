import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.resolve(root,'../package.json')),run=promisify(execFile)
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe'
const output=path.join(root,'test-results/activity');await fs.mkdir(output,{recursive:true})
await require('esbuild').build({entryPoints:[path.join(root,'scripts/fixtures/activity-phone.ts')],outfile:path.join(output,'phone.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:"import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);"},external:['electron','sharp','7zip-bin','ffmpeg-static'],logLevel:'warning'})
let requests=0;const received=[]
const mock=http.createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const b of req)chunks.push(b)
    if(req.url?.endsWith('/models')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'mobile-fixture'},{id:'mobile-fixture-other'}]}));return}
    if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return}
    const body=JSON.parse(Buffer.concat(chunks).toString());requests++
    const instructions=String(body.instructions||'')+JSON.stringify(body.input?.filter(i=>i.role==='developer'||i.role==='system')||[])
    const tools=(body.tools||[]).flatMap(t=>t.type==='namespace'?(t.tools||[]).map(child=>({...child,namespace:t.name})):[t])
    received.push({request:requests,model:body.model,reasoning:body.reasoning,desktopGuidance:instructions.includes('工作台按需执行规则'),customGuidance:instructions.includes('MOBILE_CUSTOM_PROMPT_SENTINEL'),platformGuidance:instructions.includes('Fabric Loader 不自带完整 Fabric API'),toolNames:tools.map(t=>t.name),inputTypes:body.input?.map(i=>i.type)})
    await fs.writeFile(path.join(output,'protocol.json'),JSON.stringify({requests,received},null,2))
    if(JSON.stringify(body.input).includes('CANCEL_MOBILE_FIXTURE')){
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      for(const v of [{type:'response.created',response:{id:'cancel-response'}},{type:'response.output_item.added',output_index:0,item:{type:'reasoning',id:'cancel-reasoning',summary:[],content:[]}},{type:'response.reasoning_summary_text.delta',item_id:'cancel-reasoning',output_index:0,summary_index:0,delta:'正在验证停止后保留过程。'}])res.write('data: '+JSON.stringify(v)+'\n\n')
      return // Deliberately holds the stream until the phone cancels it.
    }
    const results=body.input?.filter(i=>i.type==='function_call_output')||[]
    const n=results.length,items=[]
    items.push({type:'reasoning',id:'reasoning-'+requests,summary:[{type:'summary_text',text:'检查项目文件，再保存验证结果。'}],content:[{type:'reasoning_text',text:'手机实际返回的思考正文，用于验证展示与回放。'}],encrypted_content:'PRIVATE_ENCRYPTED_FIXTURE_MUST_NOT_APPEAR'})
    if(n<4){
      items.push({type:'message',role:'assistant',id:'commentary-'+requests,phase:'commentary',content:[{type:'output_text',text:n===0?'我先读取项目文件。':'文件已读取，现在保存验证结果。'}]})
      const suffix=n<2?'modmind_mobile_skills':n===2?'modmind_mobile_query':'modmind_mobile_write',tool=tools.find(t=>t.name?.endsWith(suffix));assert.ok(tool,'MCP tool present '+suffix)
      const args=n===0?{operation:'list'}:n===1?{operation:'read',name:'minecraft-build-repair'}:n===2?{operation:'read',path:'README.md'}:{operation:'save',path:body.model==='mobile-fixture-other'?'docs/activity-other.json':'docs/activity-check.json',content:'{"activity":true}',revision:null}
      items.push({type:'function_call',id:'function-'+requests,call_id:'call-'+requests,name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(args)})
    }else items.push({type:'message',role:'assistant',id:'final-'+requests,phase:'final_answer',content:[{type:'output_text',text:'已完成过程验证，文件已保存。'}]})
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'})
    const emit=v=>res.write('data: '+JSON.stringify(v)+'\n\n')
    emit({type:'response.created',response:{id:'resp-'+requests,status:'in_progress'}})
    for(const item of items){
      if(item.type==='reasoning'){
        emit({type:'response.output_item.added',output_index:0,item:{...item,summary:[],content:[]}})
        emit({type:'response.reasoning_summary_text.delta',item_id:item.id,output_index:0,summary_index:0,delta:'检查项目文件，再保存验证结果。'})
        emit({type:'response.reasoning_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'手机实际返回的思考正文，用于验证展示与回放。'})
      }
      emit({type:'response.output_item.done',item})
      await new Promise(r=>setTimeout(r,70))
    }
    emit({type:'response.completed',response:{id:'resp-'+requests,status:'completed',output:items,usage:{input_tokens:100,output_tokens:20,total_tokens:120}}});res.end()
  }catch(e){console.error(e.message);if(!res.headersSent)res.writeHead(500);res.end('{}')}
})
await new Promise(r=>mock.listen(19089,'127.0.0.1',r))
try{
  await run(adb,['-d','reverse','tcp:19089','tcp:19089'],{timeout:10000});await run(adb,['-d','push',path.join(root,'dist/runtime/desktop-ai.json'),'/data/local/tmp/modmind-desktop-ai-qa.json']);await run(adb,['-d','shell','run-as','dev.modmind','cp','/data/local/tmp/modmind-desktop-ai-qa.json','files/home/.modmind-mobile/runtime/desktop-ai.json'])
  await run(adb,['-d','push',path.join(output,'phone.mjs'),'/data/local/tmp/modmind-activity-qa.mjs'],{timeout:15000})
  await run(adb,['-d','shell','run-as','dev.modmind','cp','/data/local/tmp/modmind-activity-qa.mjs','files/activity-qa.mjs'],{timeout:10000})
  const child=spawn(adb,['-d','shell','run-as','dev.modmind','files/u/bin/node','files/activity-qa.mjs'],{env:{...process.env,ADB_LIBUSB:'0'}})
  let log='';for(const s of [child.stdout,child.stderr])s.on('data',b=>{log+=b.toString();process.stdout.write(b)})
  const code=await new Promise(r=>child.once('close',r));await fs.writeFile(path.join(output,'native-run.log'),log)
  const data=await run(adb,['-d','shell','run-as','dev.modmind','cat','files/home/.modmind-mobile/qa-activity/result.json'],{timeout:10000,maxBuffer:8*1024*1024})
  await fs.writeFile(path.join(output,'events.json'),data.stdout);assert.ok(!data.stdout.includes('PRIVATE_ENCRYPTED_FIXTURE_MUST_NOT_APPEAR'))
  await fs.writeFile(path.join(output,'protocol.json'),JSON.stringify({requests,received,code},null,2));assert.equal(code,0)
  assert.ok(received.some(r=>r.desktopGuidance&&r.customGuidance&&r.platformGuidance),'Exact desktop guidance and current user prompt reach native inference')
  assert.ok(received.some(r=>r.reasoning?.effort==='high'),'Selected reasoning effort reaches actual Responses request')
  assert.ok(received.some(r=>r.model==='mobile-fixture-other'),'A second selected model actually receives native inference')
  console.log('PASS Android native app-server → delivered reasoning → MCP read/write → durable activity timeline (isolated fixture, no quota used)')
}finally{mock.closeAllConnections();await new Promise(r=>mock.close(r));await run(adb,['-d','reverse','--remove','tcp:19089']).catch(()=>{})}
