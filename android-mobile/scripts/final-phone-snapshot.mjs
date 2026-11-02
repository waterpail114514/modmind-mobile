// Read-only delivery checks. Do not serialize credentials, account names or balances.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phoneRpc}=await import('./phone-rpc.mjs'),run=promisify(execFile)
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe'
const {projects}=await phoneRpc('query',{operation:'projects'}),account=await phoneRpc('account',{operation:'status'})
assert.ok(account.connected,'phone account must survive the final APK update')
let conversations=0,completedBuilds=0
for(const project of projects){
  const {tasks}=await phoneRpc('query',{operation:'tasks',projectId:project.id})
  assert.ok(tasks.every(task=>task.status!=='running'),'builds must finish before shutdown')
  completedBuilds+=tasks.filter(task=>task.status==='completed').length
  const images=await phoneRpc('images',{operation:'list',projectId:project.id})
  assert.notEqual(images.task?.status,'running','images must finish before shutdown')
  for(const surface of ['workspace','inspiration']){
    const history=await phoneRpc('ai',{operation:'list',projectId:project.id,surface})
    for(const conversation of history.conversations){
      const value=await phoneRpc('ai',{operation:'read',projectId:project.id,conversationId:conversation.id})
      assert.equal(value.running,false,'AI must finish before shutdown');conversations++
    }
  }
}
const termux=await run(adb,['-d','shell','pidof','com.termux']).catch(()=>({stdout:''}))
assert.equal(termux.stdout.trim(),'','Termux must remain stopped')
const {stdout:packageInfo}=await run(adb,['-d','shell','dumpsys','package','dev.modmind'])
assert.ok(packageInfo.includes('versionName=0.3.0-pilot.3'))
const ui=JSON.parse(await fs.readFile('test-results/minimal/ui.json','utf8'))
const results=JSON.parse(await fs.readFile('test-results/minimal/results.json','utf8'))
assert.equal(ui.checked.length,12);assert.equal(results.checked.length,6)
const bytes=await fs.readFile('android/app/build/outputs/apk/debug/app-debug.apk')
const summary={verifiedAt:new Date().toISOString(),version:'0.3.0-pilot.3',apkBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),accountConnected:true,projects:projects.length,conversations,completedBuilds,activeTasks:0,termuxRunning:false,backendChecks:46,uiChecks:ui.checked.length,resultChecks:results.checked.length,paidImageGenerationTested:false}
await fs.writeFile('test-results/minimal/final.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
