import { execFileSync } from 'node:child_process'
const adb = process.env.ADB || 'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe'
export function phoneToken() {
  const text = execFileSync(adb, ['-d', 'shell', 'run-as', process.env.MODMIND_PACKAGE || 'dev.modmind.mobile.pilot', 'cat', process.env.MODMIND_PACKAGE === 'dev.modmind' ? 'shared_prefs/mobile.MainActivity.xml' : 'shared_prefs/dev.modmind.mobile.MainActivity.xml'], { encoding: 'utf8',timeout:5000 })
  const token = text.match(/name="runtimeToken">([a-f0-9]{64})</)?.[1]
  if (!token) throw Error('Missing phone runtime credentials')
  return token
}
export async function phoneRpc(action, input) {
  const response = await fetch('http://127.0.0.1:' + (process.env.MODMIND_PHONE_PORT || '19085') + '/rpc', { method: 'POST', headers: { 'x-modmind-token': phoneToken(), 'content-type': 'application/json' }, body: JSON.stringify({ action, input }), signal: AbortSignal.timeout(15000) })
  const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value
}
if (process.argv[1]?.endsWith('phone-rpc.mjs')) console.log(JSON.stringify(await phoneRpc(process.argv[2], JSON.parse(process.argv[3] || '{}')), null, 2))
