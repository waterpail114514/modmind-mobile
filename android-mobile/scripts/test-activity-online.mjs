// One read-only request on the already configured account; never changes account/model.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phoneRpc}=await import('./phone-rpc.mjs'),root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'test-results/activity')
const status=await phoneRpc('account',{operation:'status'})
if(!status.connected)throw Error('Real phone account is not connected; no settings changed')
const fixture=JSON.parse(await fs.readFile(path.join(output,'ui-fixture.json'),'utf8')),project=fixture.projects.find(p=>p.kind==='mod')
const c=await phoneRpc('ai',{operation:'create',projectId:project.id,surface:'inspiration'})
await phoneRpc('ai',{operation:'send',projectId:project.id,conversationId:c.id,content:'这是一条手机端真实连接验证。请使用项目工具读取 README.md，然后仅用一句中文说明它的第一行。不要编辑文件、构建、生成图片或进行其他操作。'})
let result,end=Date.now()+150000
do{await new Promise(r=>setTimeout(r,700));result=await phoneRpc('ai',{operation:'read',projectId:project.id,conversationId:c.id})}while(result.running&&Date.now()<end)
if(result.running){await phoneRpc('ai',{operation:'cancel',projectId:project.id,conversationId:c.id});throw Error('Online request timed out; cancellation requested')}
await fs.writeFile(path.join(output,'online-events.json'),JSON.stringify(result,null,2))
const events=result.events.map(e=>e.payload),summary={finished:!result.running,conversation:c.id,project:project.id,errors:events.filter(p=>p.kind==='error').map(p=>p.content),compatibilityFallback:events.some(p=>p.content?.includes('使用兼容模式')),readCompleted:events.some(p=>p.mobileTool?.operation==='read'&&p.activity?.status==='completed'),answer:events.find(p=>p.kind==='answer')?.content,reasoningDelivered:events.filter(p=>p.reasoning?.phase==='completed').map(p=>({summary:!!p.reasoning.summary?.join(''),text:!!p.reasoning.text?.join('')}))}
await fs.writeFile(path.join(output,'online.json'),JSON.stringify(summary,null,2))
assert.deepEqual(summary.errors,[]);assert.equal(summary.compatibilityFallback,false);assert.equal(summary.readCompleted,true);assert.ok(summary.answer)
console.log(JSON.stringify({passed:true,nativeAppServer:true,readCompleted:true,reasoningItems:summary.reasoningDelivered.length,finalAnswer:true}))
