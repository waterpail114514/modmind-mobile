import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { phoneToken } from './phone-rpc.mjs'
const run = promisify(execFile), adb = process.env.ADB || 'D:/Codex/UserData/tools/android/platform-tools/adb.exe'
const token = phoneToken(), start = Date.now()
for (let i = 0; i < 12; i++) {
  try {
    await run(adb, ['-d', 'shell', '-n', '-T', 'echo', 'alive'], { timeout: 4000 })
    const response = await fetch('http://127.0.0.1:19085/health', { headers: { 'x-modmind-token': token }, signal: AbortSignal.timeout(4000) })
    if (!response.ok) throw Error('HTTP ' + response.status)
    console.log(Math.round((Date.now() - start) / 1000) + 's ADB + phone runtime responding')
  } catch (error) { console.log('LIVENESS_FAILED ' + error.message); process.exitCode = 1; break }
  await new Promise(resolve => setTimeout(resolve, 3000))
}
