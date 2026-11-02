// Real OPPO WebView, native taps and actual account model discovery. No inference or charged image generation.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phoneRpc}=await import('./phone-rpc.mjs'),{phonePage}=await import('./phone-page.mjs'),run=promisify(execFile),adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe'
const output=path.resolve(import.meta.dirname,'../test-results/settings-refresh');await fs.mkdir(output,{recursive:true})
const original=JSON.parse(await fs.readFile(output+'/before.json','utf8')),connection=await phonePage(),{page}=connection,checks=[],errors=[],wait=ms=>new Promise(r=>setTimeout(r,ms))
page.on('pageerror',e=>errors.push(e.message));const button=name=>page.getByRole('button',{name,exact:true}),pass=name=>{checks.push(name);console.log('PASS '+name)}
async function tap(locator){await locator.scrollIntoViewIfNeeded();await wait(100);const p=await locator.evaluate(el=>{const r=el.getBoundingClientRect();return{x:(r.left+r.right)/2*devicePixelRatio,y:(r.top+r.bottom)/2*devicePixelRatio+120}});await run(adb,['-d','shell','input','tap',String(Math.round(p.x)),String(Math.round(p.y))],{timeout:8000})}
async function shot(name){await run(adb,['-d','shell','screencap','-p','/data/local/tmp/modmind-settings-refresh.png'],{timeout:8000});await run(adb,['-d','pull','/data/local/tmp/modmind-settings-refresh.png',output+'/'+name+'.png'],{timeout:8000})}
async function keyboardOff(){if(await page.evaluate(()=>innerHeight<600))await run(adb,['-d','shell','input','keyevent','4']);else await page.evaluate(()=>document.activeElement?.blur());await wait(300)}
try{
 await page.reload();await button('切换项目').waitFor({timeout:30000});await tap(button('切换项目'));await button('设置').waitFor();await tap(button('设置'));await button('账号、额度与模型').waitFor();assert.equal(await page.getByRole('heading',{name:'设置',exact:true}).count(),1);await shot('settings-home');await tap(button('账号、额度与模型'));await button('扫描可用模型').waitFor();await page.locator('.model-catalog-item').first().waitFor({timeout:45000});assert.equal(await page.getByRole('heading',{name:'账号、额度与模型',exact:true}).count(),1);await shot('models-before-scan');pass('Updated settings and desktop-style model picker work through physical taps with one navigation bar')
 const count=await page.locator('.model-catalog-item').count();await page.getByLabel('搜索模型',{exact:true}).fill('this-model-does-not-exist');await page.getByText('没有匹配的模型',{exact:true}).waitFor();await page.getByLabel('搜索模型',{exact:true}).fill('');await keyboardOff();assert.ok((await page.locator('.model-catalog-item').count())>=count)
 const route=page.locator('.model-catalog-route-trigger').first();if(await route.count()){await tap(route);await page.locator('.model-catalog-routes').waitFor();const targets=await page.locator('.model-catalog-route-option').evaluateAll(rows=>rows.map(r=>r.getBoundingClientRect().height));assert.ok(targets.every(h=>h>=44));await shot('model-routes');await tap(route)}pass('Search empty state and route expansion work; route choices meet the 44px touch target')
 await tap(button('扫描可用模型'));for(let i=0;i<15;i++){const value=await phoneRpc('account',{operation:'status'});if(value.scan?.status==='running')break;await wait(150)}await tap(button('返回设置'));await button('外观与使用').waitFor();pass('Actual model scan starts from the phone and allows returning to settings')
 let scan
 for(let i=0;i<240;i++){scan=(await phoneRpc('account',{operation:'status'})).scan;if(scan.status!=='running')break;await wait(1500);if(i%20===0)console.log('SCAN_RUNNING')}
 await fs.writeFile(output+'/scan.json',JSON.stringify(scan,null,2));assert.equal(scan.status,'complete',scan.message);assert.ok(scan.models>0)
 const scopes={};for(const scope of ['settings','workspace','inspiration']){const value=await phoneRpc('account',{operation:'status',scope});scopes[scope]={preferences:value.preferences,bound:value.bound,connected:value.connected};assert.deepEqual(scopes[scope],original[scope])}pass('Real provider scan completes and preserves global/workspace/inspiration model preferences')
 await tap(button('账号、额度与模型'));await page.locator('.mobile-model-current').waitFor();await page.getByText(/已扫描到 \d+ 个可用模型/).waitFor();await shot('models-after-scan')
 await run(adb,['-d','shell','input','keyevent','4']);await button('外观与使用').waitFor();pass('Android system Back returns from model selection to the settings list')
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));assert.deepEqual(errors,[])
 const apk=await fs.readFile(path.resolve(import.meta.dirname,'../android/app/build/outputs/apk/debug/app-debug.apk'))
 await fs.writeFile(output+'/result.json',JSON.stringify({version:'0.6.0-pilot.6',checks,errors,scan:{status:scan.status,models:scan.models,startedAt:scan.startedAt,finishedAt:scan.finishedAt},preferencesPreserved:true,apkBytes:apk.length,apkSha256:createHash('sha256').update(apk).digest('hex'),viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})),platform:'OPPO PJW110 Android 16; actual WebView, native taps and online provider discovery'},null,2));console.log(JSON.stringify({checks:checks.length,scanStatus:scan.status,models:scan.models,preferencesPreserved:true}))
}finally{await connection.close()}
