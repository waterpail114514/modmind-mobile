import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phoneToken}=await import('./phone-rpc.mjs'),token=phoneToken(),run=promisify(execFile),adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',root=path.resolve(import.meta.dirname,'../..')
const gradle=await fs.readFile(root+'/android-mobile/android/app/build.gradle','utf8'),version=gradle.match(/versionName '([^']+)'/)[1],versionCode=Number(gradle.match(/versionCode (\d+)/)[1]),apk=root+`/release/ModMind-Mobile-${version}-arm64.apk`
const call=async(action,input)=>{const r=await fetch('http://127.0.0.1:19087/rpc',{method:'POST',headers:{'x-modmind-token':token,'content-type':'application/json'},body:JSON.stringify({action,input}),signal:AbortSignal.timeout(15000)});const v=await r.json();if(!r.ok)throw Error(v.error?.message||'RPC failed');return v}
const waitForHealth=async()=>{for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:19087/health',{headers:{'x-modmind-token':token},signal:AbortSignal.timeout(1000)});if(r.ok){const health=await r.json();if(health.version===version)return health}}catch{}await new Promise(r=>setTimeout(r,500))}throw Error('Phone runtime did not become ready')}
await waitForHealth()
const before={};for(const scope of ['settings','workspace','inspiration']){const s=await call('account',{operation:'status',scope});before[scope]={connected:s.connected,preferences:s.preferences,bound:s.bound}}
const projects=(await call('query',{operation:'projects'})).projects.map(p=>p.id),settings=await call('settings',{operation:'read'})
await run(adb,['-d','install','-r',apk],{timeout:120000});await run(adb,['-d','shell','am','force-stop','dev.modmind']);await run(adb,['-d','shell','am','start','-n','dev.modmind/dev.modmind.mobile.MainActivity']);await run(adb,['-d','forward','tcp:19087','tcp:19086'])
const health=await waitForHealth()
assert.equal(health?.version,version);for(const scope of ['settings','workspace','inspiration']){const s=await call('account',{operation:'status',scope});assert.deepEqual({connected:s.connected,preferences:s.preferences,bound:s.bound},before[scope])}
assert.deepEqual((await call('query',{operation:'projects'})).projects.map(p=>p.id),projects);assert.deepEqual(await call('settings',{operation:'read'}),settings)
const info=await run(adb,['-d','shell','dumpsys','package','dev.modmind']);assert.ok(info.stdout.includes('versionName='+version));assert.ok(info.stdout.includes('versionCode='+versionCode+' '));assert.ok(!/pkgFlags=\[[^\]]*DEBUGGABLE/.test(info.stdout));const bytes=await fs.readFile(apk),result={version,appName:'ModMind',versionCode,installedRelease:true,debuggable:false,accountAndAllModelPreferencesRetained:true,projectsRetained:projects.length,settingsRetained:true,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,verifiedAt:new Date().toISOString()};const output=root+'/android-mobile/test-results/preview-release/'+version;await fs.mkdir(output,{recursive:true});await fs.writeFile(output+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
