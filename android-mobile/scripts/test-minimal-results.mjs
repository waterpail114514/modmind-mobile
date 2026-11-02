// UI fixture only. Real phone MCP services execute; no online model or image credits.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phonePage}=await import('./phone-page.mjs'),{phoneRpc}=await import('./phone-rpc.mjs')
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',run=promisify(execFile),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),require=createRequire(import.meta.url),{PNG}=require('pngjs')
const selected=(await phoneRpc('query',{operation:'projects'})).projects.find(p=>p.namespace==='independent_test'),project=await phoneRpc('query',{operation:'project',projectId:selected.id}),session=await phoneRpc('session',{projectId:project.id,readOnly:false}),root=project.path.replace(/\/projects\/.+$/,'')
const runtime=root+'/runtime'
const entry=`import {MobileAi,MobileWorkspace} from './qa-services.mjs';
import {randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';import readline from 'node:readline';
const projectId=${JSON.stringify(project.id)},root=${JSON.stringify(root)},runtime=${JSON.stringify(runtime)},config=${JSON.stringify(session.configFile)};
const workspace=new MobileWorkspace({root,runtime,gradleHome:root+'/gradle-cache'}),project=await workspace.project(projectId),ai=new MobileAi(workspace,{},async()=>{throw Error('No model calls in fixture')});
const conversation=await ai.conversations.create(project.path,{surface:'workspace',title:'界面验证 · 本地响应'}),turnId=randomUUID(),runId=randomUUID();
await ai.conversations.appendUser(project.path,conversation.id,conversation.generation,turnId,{content:'本地界面验证：模型、图片确认与构建结果。'},runId);
const child=spawn(process.execPath,[runtime+'/mcp-server.mjs'],{env:{...process.env,MODMIND_BRIDGE_CONFIG:config},stdio:['pipe','pipe','pipe']}),pending=new Map();let next=0;
readline.createInterface({input:child.stdout}).on('line',line=>{try{const value=JSON.parse(line);pending.get(value.id)?.(value)}catch{}});
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(Error('MCP timeout')),20000);pending.set(id,value=>{clearTimeout(timer);resolve(value)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n')});
let proposal,task;
try{await request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'minimal-ui-fixture',version:'1'}});
for(const [tool,args] of [['modmind_mobile_studio',{operation:'model_preview',path:'models/model.bbmodel'}],['modmind_mobile_studio',{operation:'image_draft',title:'PNG 界面测试',prompt:'本地 PNG 显示测试，不调用生图服务。'}],['modmind_mobile_task',{operation:'build',offline:true}]]){
const reply=await request('tools/call',{name:tool,arguments:args});if(reply.error||reply.result?.isError)throw Error(JSON.stringify(reply));const result=JSON.parse(reply.result.content.find(c=>c.type==='text').text);
const metadata={callId:randomUUID(),tool,operation:args.operation,status:'completed',...(args.path?{path:args.path}:{}),...(args.prompt?{prompt:args.prompt}:{}),...(tool==='modmind_mobile_task'?{taskId:result.id}:{})};
const event=await ai.conversations.appendOutput(project.path,{kind:'tool',content:tool+' · completed',time:new Date().toISOString(),projectPath:project.path,conversationId:conversation.id,generation:conversation.generation,turnId,runId,backend:'codex',mobileTool:metadata});if(args.operation==='image_draft')proposal=event.eventId;if(tool==='modmind_mobile_task')task=result.id;
}
await ai.conversations.appendOutput(project.path,{kind:'answer',content:'模型已准备好，图片等待确认，模组正在手机上构建。\\n\\n这是本地测试响应，没有调用在线模型或消耗图片额度。',time:new Date().toISOString(),projectPath:project.path,conversationId:conversation.id,generation:conversation.generation,turnId,runId,backend:'codex'});await ai.conversations.flush();console.log(JSON.stringify({conversationId:conversation.id,proposal,task}));
}finally{child.stdin.end();child.kill()}`
await fs.mkdir('test-results/minimal',{recursive:true});await fs.writeFile('test-results/minimal/qa-entry.mjs',entry)
for(const [source,target]of [['dist/runtime/server.mjs','qa-services.mjs'],['test-results/minimal/qa-entry.mjs','qa-entry.mjs']]){await run(adb,['-d','push',source,'/data/local/tmp/modmind-'+target]);await run(adb,['-d','shell','run-as','dev.modmind','cp','/data/local/tmp/modmind-'+target,runtime+'/'+target])}
const executed=await run(adb,['-d','shell','-T','run-as','dev.modmind','/data/data/dev.modmind/files/u/bin/node',runtime+'/qa-entry.mjs'],{timeout:45000,maxBuffer:4096})
const fixture=JSON.parse(executed.stdout.trim().split(/\r?\n/).at(-1));await fs.writeFile('test-results/minimal/results-fixture.json',JSON.stringify(fixture,null,2))
const {page,close}=await phonePage(),button=name=>page.getByRole('button',{name,exact:true}),checked=[]
const tap=async locator=>{await locator.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}));await wait(150);const p=await locator.evaluate(el=>{const r=el.getBoundingClientRect();return{x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2*devicePixelRatio,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2*devicePixelRatio+120}});await run(adb,['-d','shell','input','tap',String(Math.round(p.x)),String(Math.round(p.y))]);await wait(350)}
const shot=async name=>{await run(adb,['-d','shell','screencap','-p','/data/local/tmp/modmind-minimal.png']);await run(adb,['-d','pull','/data/local/tmp/modmind-minimal.png','test-results/minimal/'+name+'.png'])}
const pass=name=>{checked.push(name);console.log('PASS '+name)}
let imageId
try{
  await tap(button('切换项目'));await tap(button('模组'));await tap(page.locator('.project-row').filter({hasText:'独立环境测试'}));await tap(button('工作台'));await tap(button('对话历史'));await tap(page.locator('.history-row').filter({hasText:'界面验证 · 本地响应'}).first());await page.locator('.image-request').waitFor()
  assert.ok(await button('生成图片').count());assert.ok(await page.locator('.result-link').filter({hasText:'model.bbmodel'}).count());pass('real mobile MCP results render model and image-confirmation cards in the conversation')
  await shot('results-dark');await tap(page.locator('.result-link').filter({hasText:'model.bbmodel'}));await page.locator('.model-canvas canvas').waitFor();await tap(button('关闭model.bbmodel'));assert.ok(await page.locator('.image-request').count());pass('model result returns to the same conversation')
  let task;const end=Date.now()+120000;do{task=(await phoneRpc('query',{operation:'tasks',projectId:project.id})).tasks.find(t=>t.id===fixture.task);if(task?.status!=='running')break;await wait(1200)}while(Date.now()<end)
  assert.equal(task.status,'completed',task.log);await page.locator('.result-download').waitFor();await tap(page.locator('.result-download').first());await button('已保存到下载/ModMind').waitFor();pass('actual phone build completes and its inline result downloads through MediaStore')
  await page.reload();await page.locator('.image-request').waitFor({timeout:30000});assert.ok(await button('生成图片').count());pass('result cards and selected history survive reload without submitting an image request')
  imageId=randomUUID();const image=new PNG({width:16,height:16});for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=(y*16+x)*4;image.data.set(y<5?[70+x*5,145+y*12,75,255]:[118+x*3,85+y,57,255],i)}
  const png=PNG.sync.write(image);await fs.writeFile('test-results/minimal/result-fixture.png',png)
  const imageRoot=root+'/images/'+project.id
  await run(adb,['-d','shell','run-as','dev.modmind','mkdir','-p',imageRoot+'/requests'])
  const receipt={id:fixture.proposal,prompt:'本地 PNG 显示测试，不调用生图服务。',status:'completed',result:{id:imageId,model:'local-ui-fixture',prompt:'本地 PNG 显示测试（非 AI 生成）',createdAt:new Date().toISOString(),width:16,height:16}}
  await fs.writeFile('test-results/minimal/result-fixture.json',JSON.stringify(receipt))
  for(const [source,target]of [['test-results/minimal/result-fixture.png',imageRoot+'/'+imageId+'.png'],['test-results/minimal/result-fixture.json',imageRoot+'/requests/'+fixture.proposal+'.json']]){await run(adb,['-d','push',source,'/data/local/tmp/modmind-ui-result']);await run(adb,['-d','shell','run-as','dev.modmind','cp','/data/local/tmp/modmind-ui-result',target])}
  await page.reload();await page.locator('.result-picture img').waitFor({timeout:30000});assert.equal(await page.locator('.result-picture img').evaluate(img=>img.naturalWidth),16);await shot('inline-image-dark')
  const savedPath='src/main/resources/assets/independent_test/textures/item/ui_'+imageId.slice(0,8)+'.png'
  await tap(button('保存到项目'));await page.getByLabel('图片保存路径').fill(savedPath);await wait(650);if(await page.evaluate(()=>innerHeight<600)){await run(adb,['-d','shell','input','keyevent','4']);await wait(650)}assert.ok(await page.locator('.image-save button').evaluate(el=>el.getBoundingClientRect().right<=document.querySelector('.picture-menu').getBoundingClientRect().left),'image menu must not cover the save action');await tap(page.locator('.image-save').getByRole('button',{name:'保存',exact:true}));await button('已保存到项目').waitFor();
  const stat=await run(adb,['-d','shell','run-as','dev.modmind','stat','-c','%s',project.path+'/'+savedPath]);assert.equal(Number(stat.stdout.trim()),png.length);pass('inline PNG result saves into the real project without exposing an image workshop')
  await tap(page.locator('.picture-menu summary'));await tap(button('移除历史图片'));await page.getByRole('alertdialog').waitFor();await run(adb,['-d','shell','input','keyevent','4']);await page.getByRole('alertdialog').waitFor({state:'detached'});assert.ok(await page.locator('.result-picture img').count());
  if(!await page.locator('.picture-menu').evaluate(el=>el.open))await tap(page.locator('.picture-menu summary'));await tap(button('移除历史图片'));await tap(page.getByRole('alertdialog').getByRole('button',{name:'移除历史图片',exact:true}));await wait(500);await page.reload();await page.getByText('图片已从历史移除，项目中的文件会保留',{exact:true}).waitFor({timeout:30000});assert.equal(await button('生成图片').count(),0);pass('history removal and reload cannot accidentally offer a duplicate paid generation')
  await fs.writeFile('test-results/minimal/results.json',JSON.stringify({checked,fixture,build:task.id,generatedWithOnlineService:false},null,2))
}finally{
  if(imageId){await phoneRpc('images',{operation:'remove',projectId:project.id,imageId}).catch(()=>{})}
  await run(adb,['-d','shell','run-as','dev.modmind','rm','-f',runtime+'/qa-entry.mjs',runtime+'/qa-services.mjs']).catch(()=>{})
  await close()
}
