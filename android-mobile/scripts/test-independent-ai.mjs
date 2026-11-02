// A local protocol fixture, never a real model or a quota-consuming request.
import http from 'node:http'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import fs from 'node:fs/promises'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phoneRpc}=await import('./phone-rpc.mjs')
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',run=promisify(execFile)
const requests=[]
const mock=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  res.setHeader('Content-Type','application/json')
  if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'mobile-fixture'}]}));return}
  if(req.url==='/v1/responses'){res.writeHead(404);res.end(JSON.stringify({error:{message:'responses endpoint not found'}}));return}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end('{}');return}
  const body=JSON.parse(Buffer.concat(chunks).toString());requests.push({tools:body.tools?.map(t=>t.function?.name),messages:body.messages})
  const toolResults=body.messages.filter(m=>m.role==='tool')
  let message
  if(toolResults.length<2){
    const suffix=toolResults.length===0?'modmind_mobile_query':'modmind_mobile_write'
    const tool=body.tools.find(t=>t.function?.name.endsWith(suffix));
    if(!tool){res.writeHead(400);res.end(JSON.stringify({error:{message:'Missing expected MCP tool '+suffix}}));return}
    const args=toolResults.length===0?{operation:'read',path:'README.md'}:{operation:'save',path:'docs/independent-ai-check.json',content:'{"phoneCodex":true}',revision:null}
    message={role:'assistant',content:null,tool_calls:[{id:'fixture-'+toolResults.length,type:'function',function:{name:tool.function.name,arguments:JSON.stringify(args)}}]}
  }else message={role:'assistant',content:'已通过手机内置 Codex 读取项目并保存测试文件。'}
  res.end(JSON.stringify({id:'fixture-completion',object:'chat.completion',created:Math.floor(Date.now()/1000),model:body.model,choices:[{index:0,message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}))
})
await new Promise(resolve=>mock.listen(19089,'127.0.0.1',resolve))
await run(adb,['-d','reverse','tcp:19089','tcp:19089'])
try{
  const current=await phoneRpc('account',{operation:'status'});assert.equal(current.connected,false,'Fixture must not replace a user account')
  const {projects}=await phoneRpc('query',{operation:'projects'})
  const project=projects.find(p=>p.namespace==='independent_test')||await phoneRpc('create',{name:'独立环境测试',namespace:'independent_test',kind:'mod'})
  await phoneRpc('account',{operation:'configure',baseUrl:'http://127.0.0.1:19089/v1',apiKey:'fixture-only',model:'mobile-fixture'})
  const c=await phoneRpc('ai',{operation:'create',projectId:project.id,surface:'workspace'})
  await phoneRpc('ai',{operation:'send',projectId:project.id,conversationId:c.id,content:'使用 MCP 读取 README，然后新建 docs/independent-ai-check.json。'})
  let result
  const end=Date.now()+90000
  do {await new Promise(resolve=>setTimeout(resolve,1000));result=await phoneRpc('ai',{operation:'read',projectId:project.id,conversationId:c.id});if(!result.running)break}while(Date.now()<end)
  const output=result.events.map(e=>e.payload?.content).filter(Boolean).join('\n')
  console.log(output)
  await fs.mkdir('test-results/independent',{recursive:true})
  await fs.writeFile('test-results/independent/codex-fixture.json',JSON.stringify({requests,events:result.events,running:result.running},null,2))
  assert.equal(result.running,false,'Agent must finish')
  assert.ok(!result.events.some(e=>e.payload?.kind==='error'),'No Codex or MCP error')
  const saved=await phoneRpc('query',{operation:'read',projectId:project.id,path:'docs/independent-ai-check.json'})
  assert.equal(JSON.parse(saved.content).phoneCodex,true)
  assert.ok(requests.length>=3,'Actual Codex tool loop reached the fixture at least three times')
  console.log('PASS Android-owned Codex SDK → MCP read → MCP write → persisted conversation')
}finally{
  await phoneRpc('account',{operation:'logout'}).catch(()=>{})
  await run(adb,['-d','reverse','--remove','tcp:19089'])
  mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve))
}
