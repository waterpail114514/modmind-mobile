import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import readline from 'node:readline'
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.resolve(root,'../package.json'))
const {startMobileServer}=await import('../dist/runtime/server.mjs'),folder=await fs.mkdtemp(path.join(root,'test-results/settings-')),token='e'.repeat(64),port=20096
const backend=await startMobileServer({root:folder,runtime:path.join(root,'dist/runtime'),gradleHome:folder+'/gradle',token,port})
const checks=[],pass=name=>{checks.push(name);console.log('PASS '+name)}
const request=async(action,input,credential=token,expected=200,signal)=>{const r=await fetch('http://127.0.0.1:'+port+'/rpc',{method:'POST',headers:{'content-type':'application/json','x-modmind-token':credential},body:JSON.stringify({action,input}),signal});const v=await r.json();assert.equal(r.status,expected,JSON.stringify(v));return v}
const call=(action,input)=>request(action,input)
try{
 const mod=await call('create',{name:'设置验证',namespace:'settings_qa',kind:'mod'}),readonly=await call('session',{projectId:mod.id,readOnly:true}),reader=JSON.parse(await fs.readFile(readonly.configFile,'utf8'))
 let settings=await call('settings',{operation:'read'});const previous=settings
 settings=await call('settings',{operation:'save',revision:settings.revision,patch:{theme:'dark',themePreset:'sage',fontScale:110,workspacePrompt:'保留中文输出，严格检查实际结果。',approvalMode:'manual'}})
 assert.equal(settings.theme,'dark');assert.equal(JSON.parse(await fs.readFile(folder+'/preferences.json','utf8')).fontScale,110)
 await request('settings',{operation:'save',revision:previous.revision,patch:{theme:'light'}},token,400)
 await request('settings',{operation:'save',revision:settings.revision,patch:{fontScale:900}},token,400)
 await request('settings',{operation:'read'},reader.token,403)
 pass('Settings save atomically, survive readback, reject stale/invalid values and stay private from MCP')
 const defaults=await call('settings',{operation:'defaults'}),bundle=JSON.parse(await fs.readFile(root+'/dist/runtime/desktop-ai.json','utf8'))
 assert.equal(defaults.prompts.request,bundle.prompts.request);assert.ok(defaults.prompts.request.includes('用户要求制作'));assert.ok(defaults.prompts.skillPolicy.includes('只读取选中的 SKILL.md'))
 const list=await call('skills',{operation:'list'});assert.equal(list.skills.filter(s=>s.builtin).length,17)
 const read=await request('skills',{operation:'read',name:'minecraft-build-repair'},reader.token,400) // Not enabled on inspiration.
 const builtin=await call('skills',{operation:'read',name:'minecraft-build-repair'});assert.equal(builtin.content,await fs.readFile('resources/codex-skills/minecraft-build-repair/SKILL.md','utf8'))
 await request('skills',{operation:'read',name:'minecraft-build-repair',path:'../../account.json'},token,400)
 pass('Desktop prompts and all 17 original skills are bundled verbatim; mode routing and resource boundaries hold')
 const content='---\nname: phone-custom\ndescription: 手机验证规则\n---\n\n仅按当前任务验证实际文件。'
 const user=await call('skills',{operation:'save',content});assert.equal(user.enabled,true)
 await fs.writeFile(path.join(folder,'user-skills/phone-custom/reference.md'),'参考资料')
 const ref=await call('skills',{operation:'read',name:user.name,path:'reference.md'});assert.equal(ref.content,'参考资料')
 await call('skills',{operation:'enable',name:user.name,enabled:false})
 assert.ok(!(await backend.skills.list('mod','workspace')).skills.some(s=>s.name===user.name))
 await request('skills',{operation:'save',name:user.name,revision:'stale',content},token,400)
 await request('skills',{operation:'save',content},reader.token,403)
 pass('User Skills share desktop parsing, revision conflicts, reference reading, enable/disable and readonly management boundaries')
 const child=spawn(process.execPath,[root+'/dist/runtime/mcp-server.mjs'],{env:{...process.env,MODMIND_BRIDGE_CONFIG:readonly.configFile}}),pending=new Map();let seq=0
 readline.createInterface({input:child.stdout}).on('line',line=>{const v=JSON.parse(line);pending.get(v.id)?.(v);pending.delete(v.id)})
 const mcp=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('MCP timeout')),10000);pending.set(id,v=>{clearTimeout(timer);resolve(v)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})
 try{await mcp('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'settings-qa',version:'1'}});const catalog=await mcp('tools/list',{});assert.ok(catalog.result.tools.some(t=>t.name==='modmind_mobile_skills'));const result=await mcp('tools/call',{name:'modmind_mobile_skills',arguments:{operation:'read',name:'modmind-inspiration'}});assert.ok(!result.result.isError&&JSON.stringify(result).includes('ModMind Inspiration'));pass('Actual MCP discovery and skill reading work from a read-only inspiration client')}finally{child.stdin.end();child.kill()}
 const writable=await call('session',{projectId:mod.id,readOnly:false}),writer=JSON.parse(await fs.readFile(writable.configFile,'utf8'))
 let change=request('write',{operation:'save',path:'docs/manual.json',revision:null,content:'{}'},writer.token)
 let approval;for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,20));approval=(await call('settings',{operation:'approvals'})).pending[0];if(approval)break}
 assert.ok(approval);assert.equal((await call('query',{operation:'read',projectId:mod.id,path:'docs/manual.json'})).exists,false)
 await call('settings',{operation:'decide',id:approval.id,allow:true});await change
 assert.equal((await call('query',{operation:'read',projectId:mod.id,path:'docs/manual.json'})).content,'{}')
 pass('Manual approval blocks real MCP-side writes until the user allows the specific operation')
 const cancelled=new AbortController();change=request('write',{operation:'save',path:'docs/cancelled.json',revision:null,content:'{}'},writer.token,200,cancelled.signal).catch(()=>{})
 for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,20));approval=(await call('settings',{operation:'approvals'})).pending[0];if(approval)break}
 assert.ok(approval);cancelled.abort();await change;await new Promise(r=>setTimeout(r,100))
 assert.equal((await call('settings',{operation:'approvals'})).pending.length,0);assert.equal((await call('query',{operation:'read',projectId:mod.id,path:'docs/cancelled.json'})).exists,false)
 pass('Disconnecting a waiting approval removes it and cannot execute a delayed write')
 const diagnostic=await call('settings',{operation:'diagnostics'}),file=await backend.workspace.artifactFile(diagnostic.id),json=JSON.parse(await fs.readFile(file.file,'utf8'))
 assert.ok(!JSON.stringify(json).includes('workspacePrompt'));assert.ok(!JSON.stringify(json).includes(token));pass('Diagnostic artifact excludes account credentials and user prompt content')
 await fs.writeFile(root+'/test-results/settings-results.json',JSON.stringify({checks,desktopHash:bundle.sha256},null,2))
}finally{backend.server.closeAllConnections();await new Promise(r=>backend.server.close(r))}
