import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { phoneRpc, phoneToken } from './phone-rpc.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(path.join(path.dirname(root), 'package.json'))
const run = promisify(execFile), adb = process.env.ADB || 'D:/Codex/UserData/tools/android/platform-tools/adb.exe', yauzl = require('yauzl')
const output = path.join(root, 'test-results/phone')
const { projects } = await phoneRpc('query', { operation: 'projects' })
const pack = projects.find(value => value.namespace === 'mobile_pack'), mod = projects.find(value => value.namespace === 'mobile_pilot')
const manifest = await phoneRpc('query', { operation: 'pack', projectId: pack.id })
assert.ok(manifest.mods.some(value => value.fileName === 'mobile_pilot-0.1.0.jar'))
const { tasks } = await phoneRpc('query', { operation: 'tasks', projectId: mod.id })
const packed = manifest.mods.find(value => value.fileName === 'mobile_pilot-0.1.0.jar')
const task = tasks.find(task => task.status === 'completed' && task.artifacts.some(artifact => artifact.sha256 === packed.sha256)); assert.ok(task)
async function entries(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error)
    const result = new Map(); zip.on('end', () => resolve(result)); zip.on('error', reject)
    zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => { if (error) return reject(error); const chunks = []; stream.on('data', bytes => chunks.push(bytes)); stream.on('error', reject); stream.on('end', () => { result.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry() }) })); zip.readEntry()
  }))
}
for (const name of ['mobile_pilot-0.1.0.jar', 'mobile_pack-0.1.0.mrpack']) await run(adb, ['-d', 'pull', '/sdcard/Download/ModMind/' + name, path.join(output, name)], { timeout: 15000 })
const jar = await fs.readFile(path.join(output, 'mobile_pilot-0.1.0.jar'))
assert.equal(createHash('sha256').update(jar).digest('hex'), task.artifacts[0].sha256)
const jarEntries = await entries(path.join(output, 'mobile_pilot-0.1.0.jar'))
assert.ok(jarEntries.has('fabric.mod.json') && jarEntries.has('dev/modmind/mobile_pilot/ModMindEntry.class'))
const packEntries = await entries(path.join(output, 'mobile_pack-0.1.0.mrpack'))
assert.deepEqual(packEntries.get('overrides/mods/mobile_pilot-0.1.0.jar'), jar)
assert.ok(packEntries.get('overrides/config/README.txt')?.length)
assert.equal(JSON.parse(packEntries.get('modrinth.index.json').toString('utf8')).dependencies.minecraft, '1.21.1')
const record = { verifiedAt: new Date().toISOString(), buildSeconds: (Date.parse(task.endedAt) - Date.parse(task.startedAt)) / 1000, jarBytes: jar.length, jarSha256: task.artifacts[0].sha256, packContainsImportedJar: true, packContainsConfiguration: true, packEntries: [...packEntries.keys()] }
const newest = tasks.find(value => value.status === 'completed' && value.id !== task.id)
if (newest) {
  const artifact = newest.artifacts[0], response = await fetch('http://127.0.0.1:19085/artifact/' + artifact.id, { headers: { 'x-modmind-token': phoneToken() } })
  assert.ok(response.ok)
  const file = path.join(output, 'item-mod.jar'); await fs.writeFile(file, Buffer.from(await response.arrayBuffer()))
  const content = await entries(file), bytecode = content.get('dev/modmind/mobile_pilot/ModMindEntry.class')?.toString('latin1') || ''
  assert.match(bytecode, /net\/minecraft\/class_\d+/)
  assert.ok(content.has('assets/mobile_pilot/models/item/phone_item.json'))
  const publicFiles = await run(adb, ['-d', 'shell', 'sha256sum', '/sdcard/Download/ModMind/*.jar'], { timeout: 10000 })
  assert.ok(publicFiles.stdout.includes(artifact.sha256))
  record.itemMod = { sha256: artifact.sha256, bytes: artifact.size, seconds: (Date.parse(newest.endedAt) - Date.parse(newest.startedAt)) / 1000, intermediaryReferences: true, itemModel: true, publicDownloadHashMatches: true }
}
await fs.writeFile(path.join(output, 'verification-artifacts.json'), JSON.stringify(record, null, 2))
console.log(JSON.stringify(record, null, 2))
