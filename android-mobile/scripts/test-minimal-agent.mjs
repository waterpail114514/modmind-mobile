import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phonePage}=await import('./phone-page.mjs'),{phoneRpc}=await import('./phone-rpc.mjs')
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',run=promisify(execFile),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const {page,close}=await phonePage(),button=name=>page.getByRole('button',{name,exact:true}),checked=[]
const tap=async locator=>{await locator.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}));await wait(150);const p=await locator.evaluate(el=>{const r=el.getBoundingClientRect();return{x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2*devicePixelRatio,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2*devicePixelRatio+120}});await run(adb,['-d','shell','input','tap',String(Math.round(p.x)),String(Math.round(p.y))]);await wait(350)}
const shot=async name=>{await run(adb,['-d','shell','screencap','-p','/data/local/tmp/modmind-minimal.png']);await run(adb,['-d','pull','/data/local/tmp/modmind-minimal.png','test-results/minimal/'+name+'.png'])}
const pass=name=>{checked.push(name);console.log('PASS '+name)}
try{
  await page.getByRole('navigation',{name:'对话模式'}).waitFor({timeout:30000})
  const account=await phoneRpc('account',{operation:'status'});assert.equal(account.preferences.billing,'free','Use the already selected free route for this UI test')
  await tap(button('切换项目'));await tap(button('模组'));await tap(page.locator('.project-row').filter({hasText:'独立环境测试'}));await tap(button('工作台'));await tap(button('新建对话'))
  const project=(await phoneRpc('query',{operation:'projects'})).projects.find(p=>p.namespace==='independent_test')
  const prompt='请调用 model_preview 展示项目已有 models/model.bbmodel；再调用 image_draft 准备一张草方块像素贴图让我确认，不要真正生成；最后离线构建当前模组并返回结果。简短回复。'
  await page.getByLabel('AI 消息').fill(prompt)
  if(await page.evaluate(()=>innerHeight<600)){await run(adb,['-d','shell','input','keyevent','4']);await wait(400)}
  await tap(button('发送消息'))
  let history,conversation
  const end=Date.now()+180000
  do{await wait(1500);conversation=(await phoneRpc('ai',{operation:'list',projectId:project.id,surface:'workspace'})).conversations[0];history=await phoneRpc('ai',{operation:'read',projectId:project.id,conversationId:conversation.id});if(!history.running&&history.events.length>1)break}while(Date.now()<end)
  await fs.writeFile('test-results/minimal/agent-history.json',JSON.stringify(history,null,2));assert.equal(history.running,false)
  assert.ok(history.events.some(e=>e.payload?.mobileTool?.operation==='image_draft'&&e.payload.mobileTool.status==='completed'));assert.ok(history.events.some(e=>e.payload?.mobileTool?.operation==='model_preview'&&e.payload.mobileTool.status==='completed'));pass('real model returns persistent image and 3D tool cards through the mobile MCP loop')
  await page.locator('.image-request').waitFor();assert.ok(await button('生成图片').count());assert.ok(await page.locator('.result-link').filter({hasText:'model.bbmodel'}).count())
  const generation=(await phoneRpc('images',{operation:'list',projectId:project.id})).task;assert.ok(!generation||generation.status!=='running');pass('image proposal appears in the conversation without starting generation')
  await shot('conversation-results-dark')
  await tap(page.locator('.result-link').filter({hasText:'model.bbmodel'}));await page.locator('.model-canvas canvas').waitFor();await shot('model-from-chat');await tap(button('关闭model.bbmodel'));assert.ok(await page.locator('.image-request').count());pass('model preview opens from its reply card and returns to the same conversation')
  const build=(await phoneRpc('query',{operation:'tasks',projectId:project.id})).tasks[0];assert.equal(build.status,'completed',build.log);assert.ok(await page.locator('.result-download').count());pass('AI build produces an inline downloadable result')
  await page.reload();await page.locator('.image-request').waitFor({timeout:30000});assert.ok(await button('生成图片').count());pass('reply cards and active conversation survive WebView reload')
  await fs.writeFile('test-results/minimal/agent.json',JSON.stringify({checked,conversationId:conversation.id,buildId:build.id},null,2))
}finally{await close()}
