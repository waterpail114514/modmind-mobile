import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.resolve(root,'../package.json')),run=promisify(execFile)
const {phonePage}=await import('./phone-page.mjs')
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',output=path.join(root,'test-results/activity'),wait=ms=>new Promise(r=>setTimeout(r,ms))
await fs.mkdir(output,{recursive:true})
let fixture
if(process.argv.includes('--reuse'))fixture=JSON.parse(await fs.readFile(path.join(output,'ui-fixture.json'),'utf8'))
else{
  await require('esbuild').build({entryPoints:[path.join(root,'scripts/fixtures/activity-ui-store.ts')],outfile:path.join(output,'ui-store.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:"import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);"},external:['electron','sharp','7zip-bin','ffmpeg-static'],logLevel:'warning'})
  await run(adb,['-d','push',path.join(output,'ui-store.mjs'),'/data/local/tmp/modmind-activity-ui-store.mjs'])
  await run(adb,['-d','shell','run-as','dev.modmind','cp','/data/local/tmp/modmind-activity-ui-store.mjs','files/activity-ui-store.mjs'])
  const result=await run(adb,['-d','shell','run-as','dev.modmind','files/u/bin/node','files/activity-ui-store.mjs'],{timeout:60000,maxBuffer:10000})
  fixture=JSON.parse(result.stdout.trim());await fs.writeFile(path.join(output,'ui-fixture.json'),JSON.stringify(fixture,null,2))
}
const {page,close}=await phonePage(),checked=[],errors=[]
page.on('pageerror',e=>errors.push(e.message))
const button=name=>page.getByRole('button',{name,exact:true})
const tap=async locator=>{
  await locator.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}));await wait(100)
  const p=await locator.evaluate(el=>{const r=el.getBoundingClientRect();return{x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2*devicePixelRatio,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2*devicePixelRatio+120}})
  await run(adb,['-d','shell','input','tap',String(Math.round(p.x)),String(Math.round(p.y))]);await wait(250)
}
const shot=async name=>{await run(adb,['-d','shell','screencap','-p','/data/local/tmp/modmind-activity-ui.png']);await run(adb,['-d','pull','/data/local/tmp/modmind-activity-ui.png',path.join(output,name+'.png')])}
const pass=name=>{checked.push(name);console.log('PASS '+name)}
const select=async(project,surface,stopped=false,theme='light')=>{
  const c=project.conversations.find(c=>c.surface===surface)
  await page.evaluate(({project,surface,c,stopped,theme})=>{
    localStorage.setItem('modmind.mobile.project',project.id);localStorage.setItem('modmind.mobile.surface',surface);localStorage.setItem('modmind.mobile.theme',theme)
    const old=JSON.parse(localStorage.getItem('modmind.mobile.active')||'[]').filter(v=>v.key!==project.id+':'+surface)
    localStorage.setItem('modmind.mobile.active',JSON.stringify([{key:project.id+':'+surface,id:stopped?c.stopped:c.id},...old].slice(0,16)))
  },{project,surface,c,stopped,theme})
  await page.reload();await page.locator(stopped?'.reply-error':'.final-message').waitFor({timeout:30000})
}
try{
  const [mod,pack]=fixture.projects
  for(const [project,surface,theme]of [[mod,'workspace','light'],[mod,'inspiration','dark'],[pack,'workspace','dark'],[pack,'inspiration','light']]){
    await select(project,surface,false,theme)
    assert.deepEqual(await page.getByRole('navigation',{name:'对话模式'}).getByRole('button').allTextContents(),['工作台','灵感台'])
    assert.equal(await page.locator('.final-message').count(),1)
    assert.equal(await page.locator('.user-message').count(),1)
    assert.ok((await page.locator('.user-message').innerText()).includes('隔离测试过程'))
    assert.equal(await page.locator('.chat-turn').evaluate(el=>el.firstElementChild?.className),'user-message')
    assert.equal(await page.locator('.agent-reasoning').count(),3)
    assert.equal(await page.locator('.agent-disclosure-header[aria-expanded="false"]').count(),3)
    assert.equal(await page.locator('.agent-disclosure-body').count(),0)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth))
    await shot(project.kind+'-'+surface+'-'+theme)
  }
  pass('Both studios and surfaces show one final answer, retained user prompt and folded reasoning without extra navigation')
  await select(mod,'workspace')
  await tap(page.locator('.agent-disclosure-header').first());await page.locator('.agent-disclosure-body').first().waitFor()
  assert.ok((await page.locator('.agent-disclosure-body').first().innerText()).includes('检查项目文件'))
  await tap(page.locator('.agent-reasoning-content > summary').first())
  assert.ok(await page.locator('.agent-disclosure-body').first().getByText('手机实际返回的思考正文，用于验证展示与回放。',{exact:true}).isVisible())
  await shot('reasoning-expanded-light')
  pass('Native touches expand delivered summary and full text independently in a bounded scroll area')
  await tap(page.locator('.agent-disclosure-header').first())
  const execution=page.locator('.agent-activity-list').filter({has:page.locator('.agent-activity-heading')})
  const fileGroup=execution.filter({hasText:'编辑了 1 个文件'}).last()
  await tap(fileGroup.locator('.agent-activity-heading'));await fileGroup.locator('.agent-activity-path').waitFor()
  await fileGroup.locator('.agent-activity-path').evaluate(el=>el.scrollIntoView({block:'center'}))
  await shot('activity-files-light');await tap(fileGroup.locator('.agent-activity-path'))
  await page.locator('.cm-content').waitFor({timeout:20000})
  assert.ok((await page.locator('.cm-content').textContent()).includes('"activity":true'))
  await tap(button('关闭项目文件'))
  pass('A completed MCP file activity opens the actual saved project source and returns to the conversation')
  await select(mod,'workspace',true,'dark')
  assert.ok((await page.locator('.reply-error').innerText()).includes('已停止'))
  assert.equal(await button('停止 AI').count(),0)
  await tap(page.locator('.agent-disclosure-header').first())
  assert.ok((await page.locator('.agent-disclosure-body').innerText()).includes('停止后保留过程'))
  await shot('cancelled-replay-dark')
  pass('Cancelled reasoning remains readable after reopening, with no running spinner or duplicate submission')
  await page.evaluate(({mod})=>{localStorage.setItem('modmind.mobile.project',mod.id);localStorage.setItem('modmind.mobile.surface','workspace');localStorage.setItem('modmind.mobile.active',JSON.stringify([{key:mod.id+':workspace',id:mod.longConversation}]))},{mod})
  await page.reload();await page.getByText('长记录已经完整载入。',{exact:true}).waitFor({timeout:30000})
  assert.equal(await page.locator('.agent-activity-heading').count(),1)
  assert.ok((await page.locator('.agent-activity-heading').innerText()).includes('130'))
  assert.equal(await page.getByText('正在载入记录',{exact:true}).count(),0)
  pass('A 132-event conversation automatically loads past the 100-event page boundary and groups 130 steps')
  const native=JSON.parse(await fs.readFile(path.join(output,'events.json'),'utf8'))
  const source=native.events.find(e=>e.payload?.activity?.status==='running'),time=new Date().toISOString(),turnId='ui-live-turn'
  const event=(sequence,kind,payload)=>({eventId:'ui-live-'+sequence,kind,sequence,turnId,time,payload:{...payload,time,turnId,runId:'ui-live-run',...(payload.activity?{activity:{...payload.activity,startedAt:time}}:{})}})
  const live=[event(1,'user',{prompt:'实时界面验证，不调用在线模型。'}),event(2,'output',{kind:'reasoning',content:'',itemId:'live-r',reasoning:{phase:'start'},time}),event(3,'output',{kind:'reasoning',content:'持续更新的思考概要',itemId:'live-r',reasoning:{phase:'delta',channel:'summary',index:0},time}),event(4,'output',{...source.payload,time,itemId:source.payload.itemId}),event(5,'output',{kind:'stream-start',content:'',itemId:'live-a',time}),event(6,'output',{kind:'delta',content:'实时文字正在更新。',itemId:'live-a',time})]
  const target=mod.conversations.find(c=>c.surface==='workspace').id
  await page.addInitScript(({target,live})=>{
    if(sessionStorage.getItem('modmind.qa.activityLive')!=='1')return
    window.addEventListener('DOMContentLoaded',()=>{
      const timer=setInterval(()=>{
        if(typeof window.__modmindReply!=='function')return
        clearInterval(timer);const original=window.__modmindReply
        window.__modmindReply=(id,packet)=>{
          if(packet.value?.id===target&&Array.isArray(packet.value.events))packet={...packet,value:{...packet.value,events:live,running:true,nextSequence:null}}
          original(id,packet)
        }
      },10)
    })
  },{target,live})
  await page.evaluate(({mod,target})=>{sessionStorage.setItem('modmind.qa.activityLive','1');localStorage.setItem('modmind.mobile.project',mod.id);localStorage.setItem('modmind.mobile.surface','workspace');localStorage.setItem('modmind.mobile.theme','light');localStorage.setItem('modmind.mobile.active',JSON.stringify([{key:mod.id+':workspace',id:target}]))},{mod,target})
  await page.reload();await button('停止 AI').waitFor({timeout:30000})
  await page.getByText('实时文字正在更新。',{exact:true}).waitFor()
  assert.equal(await page.locator('.agent-activity-list .spin').count(),1)
  assert.equal(await page.locator('.agent-disclosure-header').innerText(),'正在思考')
  assert.equal(await page.locator('.agent-disclosure-body').count(),0)
  await tap(page.locator('.agent-disclosure-header'))
  assert.ok((await page.locator('.agent-disclosure-body').innerText()).includes('持续更新的思考概要'))
  await shot('live-process-light')
  pass('Live UI fixture keeps running activity, streamed reply and stop control, with reasoning folded until tapped')
  assert.deepEqual(errors,[])
  await fs.writeFile(path.join(output,'ui.json'),JSON.stringify({checked,errors,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})),fixture:'native protocol replay, not a paid online request'},null,2))
}finally{await page.evaluate(()=>sessionStorage.removeItem('modmind.qa.activityLive')).catch(()=>{});await page.reload().catch(()=>{});await close()}
