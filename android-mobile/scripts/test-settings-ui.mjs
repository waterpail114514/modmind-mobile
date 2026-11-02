import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phoneRpc}=await import('./phone-rpc.mjs'),{phonePage}=await import('./phone-page.mjs'),run=promisify(execFile),adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',output=path.resolve(import.meta.dirname,'../test-results/settings-ui'),wait=ms=>new Promise(r=>setTimeout(r,ms))
await fs.mkdir(output,{recursive:true})
const original=await phoneRpc('settings',{operation:'read'}),account=await phoneRpc('account',{operation:'status'}),originalModel=account.preferences.model
const {page,close}=await phonePage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message))
const button=name=>page.getByRole('button',{name,exact:true}),pass=name=>{checks.push(name);console.log('PASS '+name)}
const tap=async locator=>{await locator.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}));await wait(100);const p=await locator.evaluate(el=>{const r=el.getBoundingClientRect();return{x:(r.left+r.right)/2*devicePixelRatio,y:(r.top+r.bottom)/2*devicePixelRatio+120}});await run(adb,['-d','shell','input','tap',String(Math.round(p.x)),String(Math.round(p.y))]);await wait(300)}
const shot=async name=>{await run(adb,['-d','shell','screencap','-p','/data/local/tmp/modmind-settings-ui.png']);await run(adb,['-d','pull','/data/local/tmp/modmind-settings-ui.png',path.join(output,name+'.png')])}
const keyboardOff=async()=>{if(await page.evaluate(()=>innerHeight<600))await run(adb,['-d','shell','input','keyevent','4']);else await page.evaluate(()=>document.activeElement?.blur());await wait(300)}
const back=async()=>{await tap(button('返回设置'))}
const open=async()=>{await tap(button('切换项目'));await tap(button('设置'));await button('外观与使用').waitFor()}
try{
 await page.reload();await button('切换项目').waitFor({timeout:30000});await open()
 assert.equal(await page.locator('dialog[open]').getByRole('heading',{name:'设置',exact:true}).count(),1)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await shot('settings-home-light')
 await page.getByLabel('搜索设置').fill('Gradle');assert.equal(await button('开发与构建').count(),1);await page.getByLabel('搜索设置').fill('');await keyboardOff()
 pass('Dedicated settings opens from the project drawer, has one title and searches groups at phone width')
 await tap(button('外观与使用'));await page.getByLabel('主题模式').selectOption('dark');await wait(500)
 assert.equal((await phoneRpc('settings',{operation:'read'})).theme,'dark');await shot('appearance-dark')
 await page.getByLabel('主题配色').selectOption('sage');await wait(400);assert.equal((await phoneRpc('settings',{operation:'read'})).themePreset,'sage')
 await page.getByLabel('字号').evaluate(el=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,'110');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))});await wait(100);await page.getByLabel('字号').dispatchEvent('pointerup');await wait(500)
 assert.equal((await phoneRpc('settings',{operation:'read'})).fontScale,110)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await shot('appearance-font110-dark')
 pass('Theme palette and native WebView text scale persist without horizontal overflow')
 await back();await tap(button('系统提示词'));await tap(page.getByText('工作台补充提示词',{exact:true}).first())
 await page.getByLabel('工作台补充提示词').fill('手机设置验证：尊重现有需求，按实际工具结果验收。');await keyboardOff();await tap(button('保存工作台提示词'));await wait(350)
 assert.ok((await phoneRpc('settings',{operation:'read'})).workspacePrompt.includes('手机设置验证'))
 await tap(page.getByText('查看桌面原始规则',{exact:true}));assert.ok((await page.locator('.settings-source').innerText()).includes('用户要求制作'))
 await shot('desktop-prompts-dark');await back()
 pass('Supplementary prompts save while exact synced desktop workflow remains inspectable')
 await tap(button('Skills'));await page.getByRole('button').filter({hasText:'minecraft-mod-development'}).first().waitFor();await shot('skills-dark')
 await tap(page.getByRole('button').filter({hasText:'minecraft-mod-development'}).first());assert.equal(await page.getByLabel('Skill 正文').getAttribute('readonly'),'');assert.ok((await page.getByLabel('Skill 正文').inputValue()).includes('Minecraft'))
 await back();await tap(button('Skills'));await tap(button('新建或粘贴 Skill'))
 await page.getByLabel('Skill 正文').fill('---\nname: settings-ui-phone\ndescription: 设置页面真实操作验证\n---\n\n以手机实际工具为准。');await keyboardOff();await tap(button('保存 Skill'));await wait(400)
 assert.ok((await phoneRpc('skills',{operation:'list'})).skills.some(s=>s.name==='settings-ui-phone'))
 await back();await tap(button('Skills'));await page.getByLabel('启用 settings-ui-phone').click();await wait(350);assert.equal((await phoneRpc('skills',{operation:'list'})).skills.find(s=>s.name==='settings-ui-phone').enabled,false)
 await back();pass('Built-in skill source is readable and a custom skill can be saved and disabled through the actual settings UI')
 await tap(button('开发与构建'));await page.getByLabel('构建内存').selectOption('768');await wait(400);assert.equal((await phoneRpc('settings',{operation:'read'})).buildMemoryMb,768)
 await page.getByLabel('执行审批').selectOption('manual');await wait(400);assert.equal((await phoneRpc('settings',{operation:'read'})).approvalMode,'manual');await shot('build-dark');await back()
 await tap(button('存储与缓存'));await page.getByText('Gradle 与依赖缓存',{exact:true}).waitFor({timeout:20000});assert.ok((await page.locator('.setting-row').first().innerText()).includes('MiB'));await shot('storage-dark');await back()
 await tap(button('桌面设置对照'));assert.ok((await page.locator('.settings-boundary').allTextContents()).some(s=>s.includes('没有配置云端构建')));await shot('desktop-boundaries-dark');await back()
 pass('Build preferences, real storage usage and desktop-specific limits are reachable without exposing workshops as primary pages')
 await tap(button('账号、额度与模型'));await page.getByLabel('AI 模型',{exact:true}).waitFor({timeout:30000});await page.getByLabel('AI 模型',{exact:true}).locator('option').nth(1).waitFor({state:'attached',timeout:45000})
 const choices=await page.getByLabel('AI 模型',{exact:true}).locator('option').count();assert.ok(choices>1)
 const before=(await phoneRpc('account',{operation:'status'})).preferences
 await page.getByLabel('思考强度').selectOption('auto');await wait(350)
 await tap(page.getByText('上下文与压缩',{exact:true}));await page.getByLabel('上下文 tokens').fill('65536');await page.getByLabel('自动压缩阈值').fill('50000');await keyboardOff();await tap(button('保存上下文'));await wait(450)
 assert.equal((await phoneRpc('account',{operation:'status'})).preferences.modelContextWindows[originalModel],65536)
 await shot('models-context-dark')
 await phoneRpc('account',{operation:'preferences',model:originalModel,reasoningLevel:before.reasoningLevel,modelContextWindows:before.modelContextWindows||{},modelAutoCompactTokenLimits:before.modelAutoCompactTokenLimits||{}})
 await tap(button('关闭设置'));await page.reload();await button('切换项目').waitFor({timeout:30000})
 assert.equal((await phoneRpc('settings',{operation:'read'})).buildMemoryMb,768)
 pass('Model route catalog, exact reasoning and context fields persist through the same account service and reload')
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'ui.json'),JSON.stringify({checks,errors,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}))},null,2))
}finally{
 const current=await phoneRpc('settings',{operation:'read'}),expected={theme:'dark',themePreset:'sage',fontScale:110,workspacePrompt:'手机设置验证：尊重现有需求，按实际工具结果验收。',buildMemoryMb:768,approvalMode:'manual'},patch={};for(const[key,value]of Object.entries(expected))if(JSON.stringify(current[key])===JSON.stringify(value))patch[key]=original[key];if(Object.keys(patch).length)await phoneRpc('settings',{operation:'save',revision:current.revision,patch}).catch(()=>{})
 const custom=(await phoneRpc('skills',{operation:'list'})).skills.find(s=>s.name==='settings-ui-phone');if(custom)await phoneRpc('skills',{operation:'remove',name:custom.name,revision:custom.revision}).catch(()=>{})
 await page.reload().catch(()=>{});await close()
}
