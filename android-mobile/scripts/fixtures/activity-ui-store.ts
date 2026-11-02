import fs from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {MobileWorkspace} from '../../backend/workspace'
import {MobileAi} from '../../backend/ai'
const root='/data/data/dev.modmind/files/home/.modmind-mobile'
const keepAlive=setInterval(()=>{},1000)
const workspace=new MobileWorkspace({root,runtime:root+'/runtime',gradleHome:root+'/gradle-cache'})
const ai=new MobileAi(workspace,{} as any,async()=>{throw Error('UI fixtures do not call online models')})
const native=JSON.parse(await fs.readFile(root+'/qa-activity/result.json','utf8')),cancelled=JSON.parse(await fs.readFile(root+'/qa-activity/cancelled.json','utf8')),projects=[]
for(const kind of ['mod','modpack'] as const){
  const summary=await workspace.create({name:'过程界面验证 · '+(kind==='mod'?'模组':'整合包'),namespace:'qa_activity_'+kind,kind}),project=await workspace.project(summary.id)
  await workspace.save(project.id,{path:'docs/activity-check.json',content:'{"activity":true}',revision:null})
  const conversations=[]
  for(const surface of ['workspace','inspiration'] as const){
    const c=await ai.conversations.create(project.path,{surface,title:'AI 过程回放 · '+surface}),turnId=randomUUID(),runId=randomUUID()
    await ai.conversations.appendUser(project.path,c.id,c.generation,turnId,{prompt:'这是从手机内置 Codex 采集的隔离测试过程，验证显示与回放。'},runId)
    for(const event of native.events)if(event.kind==='output')await ai.conversations.appendOutput(project.path,{...event.payload,time:new Date().toISOString(),projectPath:project.path,conversationId:c.id,generation:c.generation,turnId,runId})
    const stopped=await ai.conversations.create(project.path,{surface,title:'AI 已停止 · '+surface}),stopTurn=randomUUID(),stopRun=randomUUID()
    await ai.conversations.appendUser(project.path,stopped.id,stopped.generation,stopTurn,{prompt:'停止任务验证'},stopRun)
    for(const event of cancelled.events)if(event.kind==='output')await ai.conversations.appendOutput(project.path,{...event.payload,time:new Date().toISOString(),projectPath:project.path,conversationId:stopped.id,generation:stopped.generation,turnId:stopTurn,runId:stopRun})
    conversations.push({surface,id:c.id,stopped:stopped.id})
  }
  let longConversation
  if(kind==='mod'){
    const c=await ai.conversations.create(project.path,{surface:'workspace',title:'AI 长记录分页验证'}),turnId=randomUUID(),runId=randomUUID()
    longConversation=c.id
    await ai.conversations.appendUser(project.path,c.id,c.generation,turnId,{prompt:'验证超过一百条过程记录后能自动继续载入。'},runId)
    for(let i=0;i<130;i++)await ai.conversations.appendOutput(project.path,{kind:'tool',content:'读取目录',time:new Date().toISOString(),projectPath:project.path,conversationId:c.id,generation:c.generation,turnId,runId,itemId:'long-'+i,streamId:'long-'+i,activity:{kind:'tool',title:'读取目录',status:'completed',startedAt:new Date().toISOString(),completedAt:new Date().toISOString()}})
    await ai.conversations.appendOutput(project.path,{kind:'answer',content:'长记录已经完整载入。',time:new Date().toISOString(),projectPath:project.path,conversationId:c.id,generation:c.generation,turnId,runId,itemId:'long-final'})
  }
  projects.push({...summary,conversations,...(longConversation?{longConversation}:{})})
}
await ai.conversations.flush();clearInterval(keepAlive);console.log(JSON.stringify({projects}))
