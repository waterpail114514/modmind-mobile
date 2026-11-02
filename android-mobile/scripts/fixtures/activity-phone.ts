// Runs in a separate app-private root; it never reads or replaces the user's account.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {startMobileServer} from '../../backend/server'
const home='/data/data/dev.modmind/files/home/.modmind-mobile'
const root=path.join(home,'qa-activity'),prefix='/data/data/dev.modmind/files/u'
const native=path.dirname(await fs.realpath(prefix+'/bin/node'))
Object.assign(process.env,{HOME:'/data/data/dev.modmind/files/home',PREFIX:prefix,PATH:prefix+'/bin:/system/bin',TMPDIR:prefix+'/tmp',LD_PRELOAD:native+'/libmm_runtime_paths.so',LD_LIBRARY_PATH:native+':'+prefix+'/lib',MODMIND_CODEX_PATH:native+'/libmm_codex_exec.so',SSL_CERT_FILE:prefix+'/etc/tls/cert.pem'})
await fs.mkdir(root,{recursive:true})
const {server}=await startMobileServer({root,runtime:home+'/runtime',gradleHome:root+'/gradle',token:'f'.repeat(64),port:19094})
const call=async(action:string,input:unknown)=>{const r=await fetch('http://127.0.0.1:19094/rpc',{method:'POST',headers:{'content-type':'application/json','x-modmind-token':'f'.repeat(64)},body:JSON.stringify({action,input})});const v:any=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v}
try{
  const p=await call('create',{name:'AI 过程迁移验证',namespace:'qa_activity',kind:'mod'})
  await call('account',{operation:'configure',baseUrl:'http://127.0.0.1:19089/v1',apiKey:'fixture-only',model:'mobile-fixture'})
  const preferences=await call('settings',{operation:'read'})
  await call('settings',{operation:'save',revision:preferences.revision,patch:{workspacePrompt:'MOBILE_CUSTOM_PROMPT_SENTINEL'}})
  await call('account',{operation:'select',model:'mobile-fixture-other'});assert.equal((await call('account',{operation:'status'})).preferences.model,'mobile-fixture-other')
  await call('account',{operation:'select',model:'mobile-fixture'})
  await call('account',{operation:'preferences',model:'mobile-fixture',reasoningLevel:'high',modelContextWindows:{'mobile-fixture':65536},modelAutoCompactTokenLimits:{'mobile-fixture':50000}})
  const c=await call('ai',{operation:'create',projectId:p.id,surface:'workspace'})
  await call('ai',{operation:'send',projectId:p.id,conversationId:c.id,content:'这是隔离的过程验证。请读取 README，再创建 docs/activity-check.json，最后说明结果。'})
  let result:any,end=Date.now()+100000
  do{await new Promise(r=>setTimeout(r,300));result=await call('ai',{operation:'read',projectId:p.id,conversationId:c.id,afterSequence:0})}while(result.running&&Date.now()<end)
  await fs.writeFile(root+'/result.json',JSON.stringify({project:p.id,conversation:c.id,...result},null,2))
  assert.equal(result.running,false)
  const events=result.events.map((e:any)=>e.payload)
  const errors=events.filter((p:any)=>p.kind==='error'||p.content?.includes('使用兼容模式'))
  assert.equal(errors.length,0,JSON.stringify(errors))
  assert.ok(events.some((p:any)=>p.reasoning?.text?.some((t:string)=>t.includes('手机实际返回的思考正文'))),'Native app-server forwards delivered reasoning text')
  assert.ok(events.some((p:any)=>p.reasoning?.summary?.some((t:string)=>t.includes('检查项目文件'))),'Native app-server forwards reasoning summary')
  assert.ok(events.some((p:any)=>p.activity?.status==='completed'&&p.mobileTool?.operation==='read'),'MCP read lifecycle')
  assert.ok(events.some((p:any)=>p.activity?.status==='completed'&&p.activity?.kind==='file'&&p.mobileTool?.operation==='save'),'MCP write lifecycle')
  assert.ok(events.filter((p:any)=>p.kind==='response').length>=2,'Retains intermediate commentary and final answer')
  assert.ok(events.some((p:any)=>p.kind==='answer'&&p.content.includes('已完成过程验证')),'Final answer is separate')
  assert.equal(JSON.parse((await call('query',{operation:'read',projectId:p.id,path:'docs/activity-check.json'})).content).activity,true)
  const cancelled=await call('ai',{operation:'create',projectId:p.id,surface:'workspace'})
  await call('ai',{operation:'send',projectId:p.id,conversationId:cancelled.id,content:'CANCEL_MOBILE_FIXTURE'})
  let pending:any,deadline=Date.now()+15000
  do{await new Promise(r=>setTimeout(r,200));pending=await call('ai',{operation:'read',projectId:p.id,conversationId:cancelled.id})}while(!pending.events.some((e:any)=>e.payload?.reasoning?.phase==='delta')&&pending.running&&Date.now()<deadline)
  assert.ok(pending.running&&pending.events.some((e:any)=>e.payload?.reasoning),'Cancellation begins after real reasoning arrives')
  await call('ai',{operation:'cancel',projectId:p.id,conversationId:cancelled.id})
  deadline=Date.now()+7000
  do{await new Promise(r=>setTimeout(r,150));pending=await call('ai',{operation:'read',projectId:p.id,conversationId:cancelled.id})}while(pending.running&&Date.now()<deadline)
  assert.equal(pending.running,false,'Cancellation settles promptly')
  assert.ok(pending.events.some((e:any)=>e.payload?.terminal&&e.payload?.kind==='warning'),'Cancellation is durable')
  await fs.writeFile(root+'/cancelled.json',JSON.stringify(pending,null,2))
  const nativeId=result.native?.codex?.sessionId
  assert.ok(nativeId,'Native conversation identity is persisted')
  await call('ai',{operation:'send',projectId:p.id,conversationId:c.id,content:'继续上一条连接验证，这次只回复一句结果。'})
  let resumed:any;deadline=Date.now()+20000
  do{await new Promise(r=>setTimeout(r,200));resumed=await call('ai',{operation:'read',projectId:p.id,conversationId:c.id})}while(resumed.running&&Date.now()<deadline)
  assert.equal(resumed.running,false);assert.equal(resumed.native.codex.sessionId,nativeId)
  assert.equal(resumed.events.filter((e:any)=>e.payload?.kind==='answer').length,2,'Resume adds one new answer to the same conversation')
  assert.ok(!resumed.events.some((e:any)=>e.payload?.kind==='error'||e.payload?.content?.includes('使用兼容模式')))
  await fs.writeFile(root+'/resumed.json',JSON.stringify(resumed,null,2))
  await call('account',{operation:'select',scope:'workspace',model:'mobile-fixture-other'});assert.equal((await call('account',{operation:'status'})).preferences.model,'mobile-fixture');assert.equal((await call('account',{operation:'status',scope:'workspace'})).preferences.model,'mobile-fixture-other')
  const other=await call('ai',{operation:'create',projectId:p.id,surface:'workspace'})
  await call('ai',{operation:'send',projectId:p.id,conversationId:other.id,content:'验证切换后的模型确实执行项目工具。'})
  deadline=Date.now()+30000
  do{await new Promise(r=>setTimeout(r,200));resumed=await call('ai',{operation:'read',projectId:p.id,conversationId:other.id})}while(resumed.running&&Date.now()<deadline)
  assert.equal(resumed.running,false);assert.ok(!resumed.events.some((e:any)=>e.payload?.kind==='error'));assert.ok(resumed.events.some((e:any)=>e.payload?.usage?.model==='mobile-fixture-other'))
  await fs.writeFile(root+'/model-switch.json',JSON.stringify(resumed,null,2))
  console.log(JSON.stringify({passed:true,eventCount:events.length,reasoning:events.filter((p:any)=>p.reasoning).length,activities:events.filter((p:any)=>p.activity).length,cancellation:true,resume:true,modelSwitch:true,project:p.id,conversation:c.id}))
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
