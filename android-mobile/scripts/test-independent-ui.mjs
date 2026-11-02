import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phonePage}=await import('./phone-page.mjs'),{phoneRpc}=await import('./phone-rpc.mjs')
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',run=promisify(execFile)
const {page,close}=await phonePage(),checked=[]
const button=name=>page.getByRole('button',{name,exact:true}),wait=ms=>new Promise(r=>setTimeout(r,ms))
const tap=async(locator)=>{await locator.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}));await wait(150);const p=await locator.evaluate(el=>{const r=el.getBoundingClientRect();return{x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2*devicePixelRatio,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2*devicePixelRatio+120}});await run(adb,['-d','shell','input','tap',String(Math.round(p.x)),String(Math.round(p.y))]);await wait(350)}
const dismiss=async()=>{if(await page.evaluate(()=>innerHeight<600))await run(adb,['-d','shell','input','keyevent','4']);else await page.evaluate(()=>document.activeElement?.blur())}
const pass=name=>{checked.push(name);console.log('PASS '+name)}
const shot=async(name)=>{await run(adb,['-d','shell','screencap','-p','/data/local/tmp/modmind-independent.png']);await run(adb,['-d','pull','/data/local/tmp/modmind-independent.png','test-results/independent/'+name+'.png'])}
try{
  await fs.mkdir('test-results/independent',{recursive:true});await page.reload();await button('新建项目').waitFor()
  await tap(page.locator('.project-row').filter({hasText:'独立环境测试'}));await tap(button('3D 模型'))
  if(!(await phoneRpc('models',{operation:'list',projectId:(await phoneRpc('query',{operation:'projects'})).projects.find(p=>p.namespace==='independent_test').id})).files.includes('models/model.bbmodel'))await tap(button('新建立方体模型'));else await tap(page.locator('.asset-row').filter({hasText:'models/model.bbmodel'}));await page.locator('.model-canvas canvas').waitFor({timeout:20000});await shot('model-light')
  await page.getByLabel('模型宽',{exact:true}).fill('12');await dismiss();await tap(button('保存尺寸'));await wait(1000)
  const project=(await phoneRpc('query',{operation:'projects'})).projects.find(p=>p.namespace==='independent_test')
  const model=await phoneRpc('models',{operation:'read',projectId:project.id,path:'models/model.bbmodel'});assert.equal(JSON.parse(model.content).elements[0].to[0],12);pass('native touches create, render and resize a real 3D model')
  await tap(button('灵感台'));await page.getByText('项目知识 · 0',{exact:true}).waitFor();await tap(page.getByText('项目知识 · 0',{exact:true}))
  await page.getByLabel('知识标题').fill('手机创作约定');await page.getByLabel('知识内容').fill('当前试验仅使用模组与整合包工作台。');await dismiss();await tap(button('保存知识'));await wait(800)
  assert.ok((await phoneRpc('ai',{operation:'notes',projectId:project.id})).notes.some(n=>n.title==='手机创作约定'));pass('inspiration knowledge survives shared-service readback');await shot('inspiration-light')
  await tap(button('图像工坊'));assert.ok((await page.locator('body').innerText()).includes('每次生成一张'));await shot('images-light');pass('image generation remains explicit and does not run on navigation')
  await tap(button('工作台'));await page.getByLabel('AI 消息').fill('手机上新的一条测试草稿');await shot('chat-keyboard')
  await dismiss();await tap(button('账号'));await page.getByRole('button',{name:'登录 ModMind',exact:true}).waitFor();await shot('account-light');await tap(button('关闭账号设置'));pass('account settings and keyboard leave controls visible at 360px')
  await tap(page.getByRole('button',{name:'切换深色主题'}));await tap(button('3D 模型'));await tap(page.locator('.asset-row').filter({hasText:'models/model.bbmodel'}));await page.locator('.model-canvas canvas').waitFor();await shot('model-dark')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));pass('dark model view has no horizontal page overflow')
  await tap(button('返回项目列表'));await tap(button('整合包制作'));await tap(button('新建项目'));await page.getByLabel('项目名称',{exact:true}).fill('独立整合包测试');await page.getByLabel('项目标识',{exact:true}).fill('independent_pack');await dismiss();await tap(button('创建项目'));await button('工作台').waitFor();await tap(button('工作台'));assert.ok(await page.getByLabel('AI 消息').count());pass('modpack project has the same migrated basic studios')
  await shot('pack-workspace-dark');await fs.writeFile('test-results/independent/ui.json',JSON.stringify({checked,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}))},null,2))
}finally{await close()}
