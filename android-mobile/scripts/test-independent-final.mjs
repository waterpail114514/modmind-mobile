import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {randomUUID,createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phonePage}=await import('./phone-page.mjs'),{phoneRpc}=await import('./phone-rpc.mjs')
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',run=promisify(execFile),require=createRequire(import.meta.url),{PNG}=require('pngjs')
const {page,close}=await phonePage(),checked=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),button=name=>page.getByRole('button',{name,exact:true})
const pass=name=>{checked.push(name);console.log('PASS '+name)}
const tap=async(locator)=>{await locator.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}));await wait(150);const p=await locator.evaluate(el=>{const r=el.getBoundingClientRect();return{x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2*devicePixelRatio,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2*devicePixelRatio+120}});await run(adb,['-d','shell','input','tap',String(Math.round(p.x)),String(Math.round(p.y))]);await wait(350)}
const shot=async(name)=>{await run(adb,['-d','shell','screencap','-p','/data/local/tmp/modmind-independent-final.png']);await run(adb,['-d','pull','/data/local/tmp/modmind-independent-final.png','test-results/independent/'+name+'.png'])}
const dismiss=async()=>{if(await page.evaluate(()=>innerHeight<600))await run(adb,['-d','shell','input','keyevent','4']);else await page.evaluate(()=>document.activeElement?.blur())}
let build,packArtifact
try{
  if(await button('返回项目列表').count())await tap(button('返回项目列表'))
  await button('新建项目').waitFor({timeout:30000});pass('app starts its own environment automatically')
  const termux=await run(adb,['-d','shell','pidof','com.termux']).catch(()=>({stdout:''}));assert.equal(termux.stdout.trim(),'');pass('Termux is stopped throughout the standalone checks')
  const account=await phoneRpc('account',{operation:'status'});assert.ok(account.connected&&!account.custom);pass('authorized account survives APK update and process restart')
  const {projects}=await phoneRpc('query',{operation:'projects'}),project=projects.find(p=>p.namespace==='independent_test'),pack=projects.find(p=>p.namespace==='independent_pack')
  const history=await phoneRpc('ai',{operation:'list',projectId:project.id,surface:'inspiration'});assert.ok(history.conversations.length);pass('conversation history survives process restart')
  await tap(page.locator('.project-row').filter({hasText:'独立环境测试'}));await tap(button('工作台'))
  await page.getByLabel('AI 消息').fill('独立版草稿恢复测试');await dismiss();await tap(button('图像工坊'));await tap(button('工作台'));assert.equal(await page.getByLabel('AI 消息').inputValue(),'独立版草稿恢复测试');await page.getByLabel('AI 消息').fill('');await dismiss();pass('message draft survives switching studios')
  const id=randomUUID(),png=new PNG({width:16,height:16});png.data.fill(255);const image=PNG.sync.write(png)
  await fs.writeFile('test-results/independent/fixture.png',image);await fs.writeFile('test-results/independent/fixture.json',JSON.stringify({id,prompt:'PNG 解码测试图（非 AI 生成）',model:'test fixture',createdAt:new Date().toISOString(),width:16,height:16}))
  const imageRoot='files/home/.modmind-mobile/images/'+project.id
  await run(adb,['-d','shell','run-as','dev.modmind','mkdir','-p',imageRoot])
  for(const suffix of ['png','json']){await run(adb,['-d','push','test-results/independent/fixture.'+suffix,'/data/local/tmp/modmind-fixture.'+suffix]);await run(adb,['-d','shell','run-as','dev.modmind','cp','/data/local/tmp/modmind-fixture.'+suffix,imageRoot+'/'+id+'.'+suffix])}
  await tap(button('图像工坊'));await tap(page.locator('.asset-row').filter({hasText:'PNG 解码测试图'}));await page.locator('.image-preview').waitFor();assert.ok(await page.locator('.image-preview').evaluate(img=>img.complete&&img.naturalWidth===16));await shot('image-preview-final')
  const imagePath=await page.getByLabel('图片项目路径').inputValue();await tap(button('保存图片到项目'));await wait(600)
  await tap(button('删除历史图片'));await page.getByRole('alertdialog').waitFor();await run(adb,['-d','shell','input','keyevent','4']);await page.getByRole('alertdialog').waitFor({state:'detached'});assert.ok(await page.locator('.image-preview').count())
  await tap(button('删除历史图片'));await tap(page.getByRole('alertdialog').getByRole('button',{name:'删除历史图片',exact:true}));await wait(600)
  const saved=await run(adb,['-d','shell','run-as','dev.modmind','stat','-c','%s','files/home/.modmind-mobile/projects/'+project.id+'/'+imagePath]);assert.equal(Number(saved.stdout.trim()),image.length);pass('image preview/apply and confirm/cancel history deletion work on the phone')
  await tap(button('构建'));await tap(button('构建模组'))
  const end=Date.now()+120000;do{await wait(1000);build=(await phoneRpc('query',{operation:'tasks',projectId:project.id})).tasks[0];if(build&&build.status!=='running')break}while(Date.now()<end)
  assert.equal(build.status,'completed',build.log);assert.ok(build.artifacts.length);pass('UI completes a phone-owned Gradle build with the bundled JDK')
  await shot('build-final');await tap(page.locator('.artifact-row').first());await wait(800)
  const jar=build.artifacts[0];await run(adb,['-d','pull','/sdcard/Download/ModMind/'+jar.name,'test-results/independent/final-mod.jar'])
  assert.equal(createHash('sha256').update(await fs.readFile('test-results/independent/final-mod.jar')).digest('hex'),jar.sha256);pass('MediaStore exports the exact compiled JAR')
  await tap(button('返回项目列表'));await tap(button('整合包制作'));await tap(page.locator('.project-row').filter({hasText:'独立整合包测试'}));await tap(button('导入模组 JAR'));await wait(1000)
  let chosen=false
  for(let attempt=0;attempt<4;attempt++){
    await run(adb,['-d','shell','uiautomator','dump','/data/local/tmp/modmind-picker.xml']);const {stdout}=await run(adb,['-d','shell','cat','/data/local/tmp/modmind-picker.xml'])
    const nodes=stdout.match(/<node\b[^>]*>/g)||[],node=nodes.find(n=>n.includes('text="'+jar.name+'"'))
    if(node){const b=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);await run(adb,['-d','shell','input','tap',String(Math.round((b[0]+b[2])/2)),String(Math.round((b[1]+b[3])/2))]);chosen=true;break}
    await run(adb,['-d','shell','input','swipe','500','1800','500','800','350']);await wait(400)
  }
  assert.ok(chosen,'The exported JAR should appear in the native document picker');await wait(1000)
  const imported=await phoneRpc('query',{operation:'files',projectId:pack.id,path:'mods'});assert.ok(imported.entries.some(e=>e.name===jar.name));pass('native document picker imports the standalone JAR into a modpack')
  await tap(button('导出整合包'));await wait(1200);await shot('pack-export-final')
  const folder=await run(adb,['-d','shell','ls','/sdcard/Download/ModMind']);const name=folder.stdout.split(/\r?\n/).find(n=>n.startsWith('independent_pack-')&&n.endsWith('.mrpack'));assert.ok(name)
  await run(adb,['-d','pull','/sdcard/Download/ModMind/'+name,'test-results/independent/final-pack.mrpack']);packArtifact={name,bytes:(await fs.stat('test-results/independent/final-pack.mrpack')).size};pass('native modpack export produces a downloadable mrpack')
  await fs.writeFile('test-results/independent/final.json',JSON.stringify({checked,build,packArtifact},null,2))
}finally{await close()}
