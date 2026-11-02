import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phoneToken}=await import('./phone-rpc.mjs'),token=phoneToken(),run=promisify(execFile),adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',root=path.resolve(import.meta.dirname,'../..'),apk=root+'/release/ModMind-Mobile-1.0.0-preview.1-arm64.apk'
const call=async(action,input)=>{const r=await fetch('http://127.0.0.1:19087/rpc',{method:'POST',headers:{'x-modmind-token':token,'content-type':'application/json'},body:JSON.stringify({action,input}),signal:AbortSignal.timeout(15000)});const v=await r.json();if(!r.ok)throw Error(v.error?.message||'RPC failed');return v}
const before={};for(const scope of ['settings','workspace','inspiration']){const s=await call('account',{operation:'status',scope});before[scope]={connected:s.connected,preferences:s.preferences,bound:s.bound}}
const projects=(await call('query',{operation:'projects'})).projects.map(p=>p.id),settings=await call('settings',{operation:'read'})
await run(adb,['-d','install','-r',apk],{timeout:120000});await run(adb,['-d','shell','am','force-stop','dev.modmind']);await run(adb,['-d','shell','am','start','-n','dev.modmind/dev.modmind.mobile.MainActivity']);await run(adb,['-d','forward','tcp:19087','tcp:19086'])
let health;for(let i=0;i<90;i++){try{const r=await fetch('http://127.0.0.1:19087/health',{headers:{'x-modmind-token':token},signal:AbortSignal.timeout(1500)});health=await r.json();if(health.version==='1.0.0-preview.1')break}catch{}await new Promise(r=>setTimeout(r,500))}
assert.equal(health?.version,'1.0.0-preview.1');for(const scope of ['settings','workspace','inspiration']){const s=await call('account',{operation:'status',scope});assert.deepEqual({connected:s.connected,preferences:s.preferences,bound:s.bound},before[scope])}
assert.deepEqual((await call('query',{operation:'projects'})).projects.map(p=>p.id),projects);assert.deepEqual(await call('settings',{operation:'read'}),settings)
const info=await run(adb,['-d','shell','dumpsys','package','dev.modmind']);assert.ok(info.stdout.includes('versionName=1.0.0-preview.1'));assert.ok(!/pkgFlags=\[[^\]]*DEBUGGABLE/.test(info.stdout));const bytes=await fs.readFile(apk),result={version:'1.0.0-preview.1',appName:'ModMind',versionCode:8,installedRelease:true,debuggable:false,accountAndAllModelPreferencesRetained:true,projectsRetained:projects.length,settingsRetained:true,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,verifiedAt:new Date().toISOString()};await fs.mkdir(root+'/android-mobile/test-results/preview-release',{recursive:true});await fs.writeFile(root+'/android-mobile/test-results/preview-release/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
