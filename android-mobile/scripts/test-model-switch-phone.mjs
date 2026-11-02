import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const{phoneRpc}=await import('./phone-rpc.mjs'),folder=path.resolve(import.meta.dirname,'../test-results/model-switch');await fs.mkdir(folder,{recursive:true})
const inspirationBefore=await phoneRpc('account',{operation:'status',scope:'inspiration'}),before=await phoneRpc('account',{operation:'status'}),catalog=await phoneRpc('account',{operation:'catalog'})
assert.ok(before.connected&&!before.custom,'Use the already authorized phone account')
const chosen=catalog.models.find(m=>m.available!==false&&m.billing==='free'&&(m.account!==before.preferences.account||m.id!==before.preferences.model))
if(!chosen)throw Error('No available alternate free model; no paid route changes will be attempted')
let active
try{
 const selected=await phoneRpc('account',{operation:'select',scope:'inspiration',model:chosen.id,account:chosen.account,billing:chosen.billing,...(chosen.group?{group:chosen.group}:{})});assert.equal(selected.status,'ok')
 await phoneRpc('account',{operation:'preferences',scope:'inspiration',model:chosen.id,reasoningLevel:'auto'})
 const project=await phoneRpc('create',{name:'模型切换验证',namespace:'qa_model_switch',kind:'mod'}),c=await phoneRpc('ai',{operation:'create',projectId:project.id,surface:'inspiration'})
 active={projectId:project.id,conversationId:c.id}
 await phoneRpc('ai',{operation:'send',...active,content:'这是一条只读连接验收。请调用项目工具读取 README.md，并用一句中文报告当前接入的模型标识和文件第一行。不要修改文件、构建、生成图片或调用其他收费操作。'})
 let value,deadline=Date.now()+120000
 do{await new Promise(r=>setTimeout(r,600));value=await phoneRpc('ai',{operation:'read',...active})}while(value.running&&Date.now()<deadline)
 assert.equal(value.running,false,'Model responds within the test deadline')
 await fs.writeFile(folder+'/events.json',JSON.stringify(value,null,2))
 const events=value.events.map(e=>e.payload),errors=events.filter(e=>e.kind==='error').map(e=>e.content),answer=events.find(e=>e.kind==='answer')?.content
 const result={selectedModel:chosen.id,reportedUsageModel:events.find(e=>e.usage?.model)?.usage.model,readCompleted:events.some(e=>e.mobileTool?.operation==='read'&&e.activity?.status==='completed'),identityMatches:answer?.includes(chosen.id),errors,project:project.id,conversation:c.id,billing:'free',restored:false}
 await fs.writeFile(folder+'/result.json',JSON.stringify(result,null,2));assert.deepEqual(errors,[]);assert.ok(result.readCompleted);assert.equal(result.reportedUsageModel,chosen.id);assert.ok(result.identityMatches)
 console.log(JSON.stringify({passed:true,modelActuallyChanged:true,readOnlyMcp:true,identityMatches:true,billing:'free'}))
}finally{
 if(active){await phoneRpc('ai',{operation:'cancel',...active}).catch(()=>{});for(let i=0;i<30;i++){const v=await phoneRpc('ai',{operation:'read',...active}).catch(()=>null);if(!v?.running)break;await new Promise(r=>setTimeout(r,100))}}
 if(inspirationBefore.bound){const p=inspirationBefore.preferences;await phoneRpc('account',{operation:'select',scope:'inspiration',model:p.model,account:p.account,billing:p.billing,...(p.group?{group:p.group}:{})});await phoneRpc('account',{operation:'preferences',scope:'inspiration',model:p.model,reasoningLevel:p.reasoningLevel,modelContextWindows:p.modelContextWindows||{},modelAutoCompactTokenLimits:p.modelAutoCompactTokenLimits||{},reasoningEffortOptions:p.reasoningEffortOptions||{}})}else await phoneRpc('account',{operation:'reset',scope:'inspiration'})
 const saved=await fs.readFile(folder+'/result.json','utf8').then(JSON.parse).catch(()=>({}));saved.restored=(await phoneRpc('account',{operation:'status'})).preferences.model===before.preferences.model;await fs.writeFile(folder+'/result.json',JSON.stringify(saved,null,2));assert.ok(saved.restored)
}
