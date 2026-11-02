// Build-time capture from the officially installed ARM64 packages used by the pilot.
// The resulting app bundles these files and never requires the Termux app at runtime.
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adb = process.env.ADB || 'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe'
await fs.mkdir(path.join(root, 'state'), { recursive: true })
const file = path.join(root, 'state/runtime-source.tar.gz')
const remote = '/data/data/com.termux/files/home/.modmind-mobile/runtime-source.tar.gz'
await promisify(execFile)(adb, ['-d', 'shell', 'run-as', 'com.termux', '/data/data/com.termux/files/usr/bin/tar', '-C', '/data/data/com.termux/files/usr', '-czf', remote, '--exclude=lib/node_modules', '--exclude=lib/python*', '--exclude=lib/llvm*', '--exclude=lib/clang', 'lib', 'bin/node', 'bin/bash', 'etc/tls', 'share/doc'], { timeout: 180000 })
const child = spawn(adb, ['-d', 'exec-out', 'run-as', 'com.termux', 'cat', remote], { stdio: ['ignore', 'pipe', 'pipe'] })
let errors = ''; child.stderr.on('data', data => { errors = (errors + data).slice(-4096) })
const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(Error(errors || 'Runtime capture failed'))) })
await Promise.all([pipeline(child.stdout, createWriteStream(file)), completed])
const handle = await fs.open(file); const header = Buffer.alloc(2); await handle.read(header, 0, 2, 0); await handle.close()
if (header[0] !== 0x1f || header[1] !== 0x8b || (await fs.stat(file)).size < 1024 * 1024) throw Error('Runtime archive is invalid')
console.log(JSON.stringify({ archive: file, bytes: (await fs.stat(file)).size }))
