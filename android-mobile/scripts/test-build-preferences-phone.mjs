import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const{phoneRpc}=await import('./phone-rpc.mjs'),root=path.resolve(import.meta.dirname,'../test-results/build-preferences');await fs.mkdir(root,{recursive:true})
const project=(await phoneRpc('query',{operation:'projects'})).projects.find(p=>p.namespace==='independent_test');assert.ok(project,'Use the existing isolated build fixture, never a user project')
const previous=await phoneRpc('settings',{operation:'read'});let task
try{
 await phoneRpc('settings',{operation:'save',revision:previous.revision,patch:{buildMemoryMb:768,offlineBuild:true}})
 task=await phoneRpc('task',{operation:'build',projectId:project.id})
 let result,deadline=Date.now()+120000
 do{await new Promise(r=>setTimeout(r,600));result=(await phoneRpc('query',{operation:'tasks',projectId:project.id})).tasks.find(t=>t.id===task.id)}while(result.status==='running'&&Date.now()<deadline)
 await fs.writeFile(root+'/task.json',JSON.stringify(result,null,2));assert.equal(result.status,'completed',result.log);assert.ok(result.artifacts.length)
 console.log(JSON.stringify({passed:true,offlineBuild:true,configuredMemoryMiB:768,artifacts:result.artifacts.length,gameVerified:false}))
}finally{
 if(task)await phoneRpc('task',{operation:'cancel',projectId:project.id,taskId:task.id}).catch(()=>{})
 const current=await phoneRpc('settings',{operation:'read'});await phoneRpc('settings',{operation:'save',revision:current.revision,patch:{buildMemoryMb:previous.buildMemoryMb,offlineBuild:previous.offlineBuild}})
}
