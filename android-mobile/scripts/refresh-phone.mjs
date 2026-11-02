import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adb = process.env.ADB || 'D:/Codex/UserData/tools/android/platform-tools/adb.exe'
const run = args => execFileSync(adb, ['-d', ...args], { encoding: 'utf8', timeout: 30000 })
// Only stop the exact pilot backend, never other Node or Termux sessions.
const processes = run(['shell', 'ps', '-A', '-o', 'PID,NAME']).split(/\r?\n/)
for (const line of processes) {
  const match = line.match(/^\s*(\d+)\s+node\s*$/); if (!match) continue
  let args
  try { args = run(['shell', 'run-as', 'com.termux', 'cat', '/proc/' + match[1] + '/cmdline']).split('\0') } catch { continue }
  if (args[1] !== '/data/data/com.termux/files/home/.modmind-mobile/runtime/server.mjs') continue
  run(['shell', 'run-as', 'com.termux', 'kill', '-TERM', match[1]])
  console.log('Stopped the owned pilot runtime for APK update')
}
if (process.argv.includes('--backend-only')) {
  run(['push', path.join(root, 'dist/runtime/server.mjs'), '/data/local/tmp/modmind-mobile-server.mjs'])
  run(['shell', 'run-as', 'com.termux', 'cp', '/data/local/tmp/modmind-mobile-server.mjs', '/data/data/com.termux/files/home/.modmind-mobile/runtime/server.mjs'])
  console.log(run(['shell', 'run-as', 'com.termux', 'am', 'startservice', '--user', '0', '-n', 'com.termux/.app.RunCommandService', '-a', 'com.termux.RUN_COMMAND', '--es', 'com.termux.RUN_COMMAND_PATH', '/data/data/com.termux/files/usr/bin/env', '--esa', 'com.termux.RUN_COMMAND_ARGUMENTS', 'MODMIND_MOBILE_BOOT=1,/data/data/com.termux/files/usr/bin/node,/data/data/com.termux/files/home/.modmind-mobile/runtime/server.mjs', '--ez', 'com.termux.RUN_COMMAND_BACKGROUND', 'true']).trim())
} else console.log(run(['install', '-r', path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk')]).trim())
run(['shell', 'am', 'force-stop', 'dev.modmind.mobile.pilot'])
console.log(run(['shell', 'am', 'start', '-n', 'dev.modmind.mobile.pilot/dev.modmind.mobile.MainActivity']).trim())
