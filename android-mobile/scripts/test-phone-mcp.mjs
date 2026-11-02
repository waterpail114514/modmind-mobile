import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { phoneRpc } from './phone-rpc.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adb = process.env.ADB || 'D:/Codex/UserData/tools/android/platform-tools/adb.exe'
const { projects } = await phoneRpc('query', { operation: 'projects' })
const project = projects.find(value => value.namespace === 'mobile_pilot'); assert.ok(project)
const checked = [], pass = name => { checked.push(name); console.log('PASS ' + name) }
function client(configFile) {
  const child = spawn(adb, ['-d', 'shell', '-T', 'run-as', 'com.termux', 'env', 'MODMIND_BRIDGE_CONFIG=' + configFile, '/data/data/com.termux/files/usr/bin/timeout', '60', '/data/data/com.termux/files/usr/bin/node', '/data/data/com.termux/files/home/.modmind-mobile/runtime/mcp-server.mjs'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let next = 0; const pending = new Map()
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let packet; try { packet = JSON.parse(line) } catch { return }
    pending.get(packet.id)?.(packet); pending.delete(packet.id)
  })
  return {
    child,
    request(method, params) { return new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => reject(Error('Phone MCP request timed out')), 15000); pending.set(id, value => { clearTimeout(timer); resolve(value) }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') }) }
  }
}
const initialize = connection => connection.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'phone-verification', version: '1' } })
const session = await phoneRpc('session', { projectId: project.id, readOnly: false }), writer = client(session.configFile)
try {
  assert.ok((await initialize(writer)).result?.capabilities?.tools); pass('MCP stdio server runs on the phone and initializes')
  const catalog = await writer.request('tools/list', {})
  assert.ok(['modmind_mobile_query', 'modmind_mobile_write', 'modmind_mobile_task'].every(name => catalog.result.tools.some(tool => tool.name === name))); pass('phone MCP discovers query, write and task tools')
  const file = 'docs/mobile-mcp-check.json'
  const old = await phoneRpc('query', { operation: 'read', projectId: project.id, path: file })
  const written = await writer.request('tools/call', { name: 'modmind_mobile_write', arguments: { operation: 'save', path: file, revision: old.revision, content: '{"verifiedOnPhone":true}\n' } })
  assert.ok(!written.error && !written.result?.isError)
  const read = await writer.request('tools/call', { name: 'modmind_mobile_query', arguments: { operation: 'read', path: file } })
  assert.ok(JSON.stringify(read).includes('verifiedOnPhone'))
  const actual = await phoneRpc('query', { operation: 'read', projectId: project.id, path: file })
  assert.equal(JSON.parse(actual.content).verifiedOnPhone, true); pass('phone MCP writes a real project file and reads it back through shared services')
  const other = projects.find(value => value.id !== project.id)
  const denied = await writer.request('tools/call', { name: 'modmind_mobile_query', arguments: { operation: 'project', projectId: other.id } })
  assert.ok(denied.error || denied.result?.isError); pass('phone MCP rejects cross-project requests')
} finally { writer.child.stdin.end(); writer.child.kill() }
const readonly = await phoneRpc('session', { projectId: project.id, readOnly: true }), reader = client(readonly.configFile)
try {
  await initialize(reader)
  const catalog = await reader.request('tools/list', {})
  assert.ok(catalog.result.tools.every(tool => ['modmind_mobile_query', 'modmind_mcp_probe', 'modmind_project_info'].includes(tool.name)))
  pass('phone read-only MCP session exposes only read operations and host probes')
} finally { reader.child.stdin.end(); reader.child.kill() }
await fs.writeFile(path.join(root, 'test-results/phone/verification-mcp.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), checked }, null, 2))
