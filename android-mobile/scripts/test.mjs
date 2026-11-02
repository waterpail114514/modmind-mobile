import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import http from 'node:http'
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.dirname(mobileRoot), require = createRequire(path.join(repo, 'package.json'))
const { startMobileServer, MobileAssets } = await import(pathToFileURL(path.join(mobileRoot, 'dist/runtime/server.mjs')).href)
const parent = path.join(mobileRoot, 'test-results'); await fs.mkdir(parent, { recursive: true })
const root = await fs.mkdtemp(path.join(parent, 'backend-'))
const token = 'a'.repeat(64), { server, workspace } = await startMobileServer({ root, runtime: path.join(mobileRoot, 'dist/runtime'), gradleHome: path.join(root, 'gradle-cache'), token, port: 20084 })
let checked = 0
const check = (name, condition) => { assert.ok(condition, name); checked++; console.log('PASS ' + name) }
async function call(action, input, credential = token, expected = 200) {
  const response = await fetch('http://127.0.0.1:20084/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-modmind-token': credential }, body: JSON.stringify({ action, input }) })
  const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value
}
function mcpClient(configFile) {
  const child = spawn(process.execPath, [path.join(mobileRoot, 'dist/runtime/mcp-server.mjs')], { env: { ...process.env, MODMIND_BRIDGE_CONFIG: configFile }, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map(); let nextId = 0
  const lines = readline.createInterface({ input: child.stdout }); lines.on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.(value); pending.delete(value.id) })
  return { child, request(method, params) { return new Promise((resolve, reject) => { const id = ++nextId, timeout = setTimeout(() => reject(Error('MCP timeout')), 10000); pending.set(id, value => { clearTimeout(timeout); resolve(value) }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') }) } }
}
async function zipEntries(file) {
  const yauzl = require('yauzl')
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => { if (error) return reject(error); const names = []; zip.on('entry', entry => { names.push(entry.fileName); zip.readEntry() }); zip.on('end', () => resolve(names)); zip.on('error', reject); zip.readEntry() }))
}
try {
  await call('query', { operation: 'projects' }, 'bad-token', 401); check('authentication rejects unknown token', true)
  await call('create', { name: 'no', namespace: 'no', kind: 'shader' }, token, 400); check('only two studios can be created', true)
  const mod = await call('create', { name: '手机模组', namespace: 'phone_test', kind: 'mod' })
  const pack = await call('create', { name: '手机整合包', namespace: 'phone_pack', kind: 'modpack' })
  check('real project generators create both studio types', mod.kind === 'mod' && pack.kind === 'modpack')
  const rootFiles = await call('query', { operation: 'files', projectId: mod.id, path: '' })
  check('empty directory path lists the real project root', rootFiles.entries.some(entry => entry.name === 'README.md'))
  await call('query', { operation: 'read', projectId: mod.id, path: '' }, token, 400); check('empty file path is still rejected for read operations', true)
  const first = await call('query', { operation: 'read', projectId: mod.id, path: 'README.md' })
  const saved = await call('write', { operation: 'save', projectId: mod.id, path: 'README.md', content: '# 手机修改\n', revision: first.revision })
  check('file save changes content and SHA-256 revision', saved.content === '# 手机修改\n' && first.revision !== saved.revision)
  await call('write', { operation: 'save', projectId: mod.id, path: 'README.md', content: 'stale', revision: first.revision }, token, 409); check('stale revision cannot overwrite newer content', true)
  const restored = await call('write', { operation: 'restore', projectId: mod.id, path: 'README.md', revision: saved.revision })
  check('history restores the previous file through shared write service', restored.content === first.content)
  await call('query', { operation: 'read', projectId: mod.id, path: '../outside.txt' }, token, 400); check('parent traversal is rejected', true)
  await call('write', { operation: 'save', projectId: mod.id, path: 'mobile.project.json', content: '{}', revision: null }, token, 400); check('managed project index cannot be edited', true)
  await call('write', { operation: 'save', projectId: mod.id, path: 'bad.json', content: '{', revision: null }, token, 400); check('invalid JSON retains the previous filesystem state', true)
  await call('write', { operation: 'save', projectId: mod.id, path: 'big.txt', content: 'x'.repeat(262145), revision: null }, token, 400); check('text size limit is enforced', true)
  const outside = path.join(root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.txt'), 'private')
  await fs.symlink(outside, path.join(workspace.projectsRoot, mod.id, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await call('query', { operation: 'read', projectId: mod.id, path: 'linked/secret.txt' }, token, 400); check('linked ancestors cannot escape a project', true)
  const readonly = await call('session', { projectId: mod.id, readOnly: true })
  const readConfig = JSON.parse(await fs.readFile(readonly.configFile, 'utf8'))
  await call('write', { operation: 'save', projectId: mod.id, path: 'README.md', content: 'forbidden', revision: restored.revision }, readConfig.token, 403)
  await call('task', { operation: 'build', projectId: mod.id }, readConfig.token, 403); check('read-only sessions reject writes and process execution', true)
  await call('query', { operation: 'read', projectId: pack.id, path: 'overrides/config/README.txt' }, readConfig.token, 403); check('session cannot switch project context', true)
  const client = mcpClient(readonly.configFile)
  try {
    const initialized = await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mobile-test', version: '1' } })
    check('existing MCP stdio transport initializes against mobile bridge', Boolean(initialized.result?.capabilities?.tools))
    const catalog = await client.request('tools/list', {})
    const names = catalog.result.tools.map(tool => tool.name)
    check('MCP discovery exposes project reads, studio queries and host probes', names.includes('modmind_mobile_query') && names.includes('modmind_mobile_project') && names.every(name => ['modmind_mobile_query', 'modmind_mobile_studio', 'modmind_mobile_project','modmind_mobile_job','modmind_mobile_skills','modmind_mcp_probe', 'modmind_project_info'].includes(name)))
    const read = await client.request('tools/call', { name: 'modmind_mobile_query', arguments: { operation: 'read', path: 'README.md' } })
    check('MCP actually reads shared service results', read.result.content.some(content => content.text?.includes('Android') || content.text?.includes('ModMind')))
    const proposal=await client.request('tools/call',{name:'modmind_mobile_studio',arguments:{operation:'image_draft',title:'像素图案',prompt:'aqua pixel icon'}})
    check('read-only inspiration prepares a conversation image proposal without generating or leasing',!proposal.result.isError&&proposal.result.content.some(item=>item.text?.includes('requiresConfirmation')))
  } finally { client.child.stdin.end(); client.child.kill() }
  const writable = await call('session', { projectId: pack.id, readOnly: false })
  const writer = mcpClient(writable.configFile)
  try {
    await writer.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mobile-test', version: '1' } })
    const changed = await writer.request('tools/call', { name: 'modmind_mobile_write', arguments: { operation: 'save', path: 'overrides/config/mcp.json', content: '{"mobile":true}\n', revision: null } })
    const readBack = await call('query', { operation: 'read', projectId: pack.id, path: 'overrides/config/mcp.json' })
    check('writable MCP session saves real configuration and UI service reads it back', !changed.result?.isError && readBack.content.includes('"mobile":true'))
  } finally { writer.child.stdin.end(); writer.child.kill() }
  const jar = await fs.readFile(path.join(mobileRoot, 'dist/runtime/gradle-wrapper.jar'))
  const imported = await fetch('http://127.0.0.1:20084/upload?projectId=' + pack.id + '&name=local-test.jar', { method: 'POST', headers: { 'x-modmind-token': token }, body: jar })
  check('JAR upload uses existing pack import service', imported.status === 200 && (await fs.stat(path.join(workspace.projectsRoot, pack.id, 'mods/local-test.jar'))).size === jar.length)
  const exported = await call('write', { operation: 'export', projectId: pack.id })
  const archive = await workspace.artifactFile(exported.id)
  const names = await zipEntries(archive.file)
  check('existing Modrinth exporter creates real mrpack archive', names.includes('modrinth.index.json'))
  check('pack export includes its actual configuration', names.includes('overrides/config/README.txt'))
  check('pack export bundles imported local JAR and MCP-written configuration', names.includes('overrides/mods/local-test.jar') && names.includes('overrides/config/mcp.json'))
  const removed = await call('write', { operation: 'remove_mod', projectId: pack.id, fileName: 'local-test.jar' })
  check('imported JAR can be removed from the pack without deleting its original source', !removed.mods.length && jar.length === (await fs.readFile(path.join(mobileRoot, 'dist/runtime/gradle-wrapper.jar'))).length && !await fs.stat(path.join(workspace.projectsRoot, pack.id, 'mods/local-test.jar')).catch(() => null))
  const uploadedAgain = await fetch('http://127.0.0.1:20084/upload?projectId=' + pack.id + '&name=local-test.jar', { method: 'POST', headers: { 'x-modmind-token': token }, body: jar })
  check('removed JAR can be imported again', uploadedAgain.ok)
  const manifestFile = path.join(workspace.projectsRoot, pack.id, 'modmind.pack.json')
  const originalManifest = await fs.readFile(manifestFile, 'utf8')
  const manifest = JSON.parse(originalManifest)
  manifest.modules = [{ name: 'external', namespace: 'external', path: outside, linked: true, createdAt: new Date().toISOString() }]
  await fs.writeFile(manifestFile, JSON.stringify(manifest))
  const blocked = await call('write', { operation: 'export', projectId: pack.id }, token, 400)
  check('mobile pack export rejects desktop external module links', blocked.error.code === 'PACK_SCOPE')
  await fs.writeFile(manifestFile, originalManifest)
  const filesRoot = path.join(workspace.projectsRoot, pack.id, 'overrides/many')
  await fs.mkdir(filesRoot)
  await Promise.all(Array.from({ length: 205 }, (_, i) => fs.writeFile(path.join(filesRoot, String(i).padStart(3, '0') + '.txt'), 'sample')))
  const page1 = await call('query', { operation: 'files', projectId: pack.id, path: 'overrides/many' })
  const page2 = await call('query', { operation: 'files', projectId: pack.id, path: 'overrides/many', offset: page1.nextOffset })
  const page3 = await call('query', { operation: 'files', projectId: pack.id, path: 'overrides/many', offset: page2.nextOffset })
  check('large directory pages are bounded and complete without duplicate entries', page1.entries.length === 100 && page2.entries.length === 100 && page3.entries.length === 5 && new Set([...page1.entries, ...page2.entries, ...page3.entries].map(entry => entry.path)).size === 205 && page3.nextOffset === null)
  const response = await fetch('http://127.0.0.1:20084/artifact/' + exported.id, { headers: { 'x-modmind-token': readConfig.token } })
  check('artifact download also enforces session project boundary', response.status === 403)
  const metadata = await fetch('http://127.0.0.1:20084/artifact/' + exported.id + '?metadata=1', { headers: { 'x-modmind-token': token } }); const details=await metadata.json()
  check('native share metadata reuses artifact identity, size and digest without exposing a filesystem path', metadata.ok && details.id===exported.id && details.sha256===exported.sha256 && details.size===exported.size && !('file' in details) && !('path' in details))
  const blockedMetadata=await fetch('http://127.0.0.1:20084/artifact/' + exported.id + '?metadata=1', { headers: { 'x-modmind-token': readConfig.token } })
  check('native share metadata also rejects another project session', blockedMetadata.status===403)
  const model = await call('models',{operation:'create',projectId:mod.id,path:'models/check.bbmodel'})
  const preview = await call('models',{operation:'preview',projectId:mod.id,path:model.path})
  check('3D source creation and preview read the same real cube',preview.blockbench.elements[0].to[0]===16)
  await call('models',{operation:'create',projectId:mod.id,path:'models/check.bbmodel'},token,409)
  await call('models',{operation:'preview',projectId:mod.id,path:'../outside.json'},token,400)
  check('model paths and existing-source revisions are protected',true)
  const studioWriter=mcpClient(writable.configFile)
  try {
    await studioWriter.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'studio-check',version:'1'}})
    const changed=await studioWriter.request('tools/call',{name:'modmind_mobile_studio',arguments:{operation:'note_save',title:'手机约定',content:'只使用当前项目'}})
    check('studio MCP writes durable inspiration knowledge',!changed.result?.isError&&(await call('ai',{operation:'notes',projectId:pack.id})).notes[0].content==='只使用当前项目')
  } finally {studioWriter.child.stdin.end();studioWriter.child.kill()}
  await call('studio',{operation:'note_save',title:'不能修改',content:'blocked'},readConfig.token,403)
  await call('account',{operation:'status'},readConfig.token,403)
  await call('studio',{operation:'models',projectId:pack.id},readConfig.token,403)
  check('inspiration cannot write notes, access credentials or switch projects',true)
  const conversation=await call('ai',{operation:'create',projectId:mod.id,surface:'inspiration'})
  await call('ai',{operation:'send',projectId:mod.id,conversationId:conversation.id,content:'离线失败也保留这条消息'})
  let history
  for(let retry=0;retry<20;retry++){history=await call('ai',{operation:'read',projectId:mod.id,conversationId:conversation.id});if(!history.running)break;await new Promise(resolve=>setTimeout(resolve,100))}
  check('conversation storage retains the prompt and login error after a failed run',history.events.some(e=>e.kind==='user'&&e.payload.prompt?.includes('保留'))&&history.events.some(e=>e.payload?.kind==='error'))
  await call('ai',{operation:'read',projectId:pack.id,conversationId:conversation.id},token,400)
  check('conversation identity is bound to its project',true)
  await call('account',{operation:'configure',baseUrl:'http://example.com/v1',apiKey:'test-only',model:'fixture'},token,400)
  const custom=await call('account',{operation:'configure',baseUrl:'http://127.0.0.1:29089/v1',apiKey:'test-only',model:'fixture'})
  check('account status never returns stored API credentials',custom.custom&&!JSON.stringify(custom).includes('test-only'))
  const usage=await call('account',{operation:'usage'})
  check('unknown custom-provider balance is not reported as zero',usage.tracked===false&&usage.balanceCents===undefined)
  await call('account',{operation:'logout'})
  const localRequire=createRequire(path.join(mobileRoot,'package.json')),{PNG}=localRequire('pngjs')
  const png=new PNG({width:2,height:2});png.data.fill(255);const pngBytes=PNG.sync.write(png),encoded=pngBytes.toString('base64');let requests=0,mode='json'
  const imageFixture=http.createServer(async(request,response)=>{
    for await(const chunk of request){}requests++
    if(mode==='json'){response.setHeader('content-type','application/json');response.end(JSON.stringify({data:[{b64_json:encoded}]}))}
    else {response.setHeader('content-type','text/event-stream');const bytes='event: image_generation.partial_image\ndata: '+JSON.stringify({type:'image_generation.partial_image',b64_json:encoded,partial_image_index:0})+'\n\nevent: image_generation.completed\ndata: '+JSON.stringify({type:'image_generation.completed',b64_json:encoded})+'\n\n';for(let i=0;i<bytes.length;i+=7)response.write(bytes.slice(i,i+7));response.end()}
  })
  await new Promise(resolve=>imageFixture.listen(0,'127.0.0.1',resolve))
  try {
    const images=new MobileAssets(workspace,{imageLease:async()=>({baseUrl:'http://127.0.0.1:'+imageFixture.address().port,apiKey:'fixture',model:'fixture',provider:mode==='sse'?'secondary':'primary'})})
    let generated
    for(mode of ['json','sse']){
      await images.images({projectId:mod.id,operation:'generate',prompt:'decoder fixture'},true)
      for(let retry=0;retry<50;retry++){generated=await images.images({projectId:mod.id,operation:'list'},true);if(generated.task.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,50))}
      check(mode+' image response stores one completed PNG without automatic retries',generated.task.status==='completed'&&requests===(mode==='json'?1:2)&&generated.images.length===(mode==='json'?1:2))
    }
    const firstReceipt=generated.task.id
    const repeated=await images.images({projectId:mod.id,operation:'generate',prompt:'decoder fixture',requestId:firstReceipt},true)
    check('reopening or resubmitting a conversation image card cannot start another charged request',repeated.taskId===firstReceipt&&requests===2)
    const id=generated.task.result.id
    const imageReader=mcpClient(readonly.configFile)
    try{
      await imageReader.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'image-check',version:'1'}})
      const image=await imageReader.request('tools/call',{name:'modmind_mobile_studio',arguments:{operation:'image',imageId:id}})
      check('existing MCP transport returns actual image content, not base64 prose',image.result.content.some(item=>item.type==='image'&&item.mimeType==='image/png'))
    }finally{imageReader.child.stdin.end();imageReader.child.kill()}
    await call('images',{projectId:mod.id,operation:'apply',imageId:id,path:'src/main/resources/assets/phone_test/textures/item/fixture.png'})
    const actual=PNG.sync.read(await fs.readFile(path.join(workspace.projectsRoot,mod.id,'src/main/resources/assets/phone_test/textures/item/fixture.png')))
    check('image apply saves an actual decoded PNG into the project',actual.width===2&&actual.height===2)
    await call('images',{projectId:mod.id,operation:'apply',imageId:id,path:'src/main/resources/assets/phone_test/textures/item/fixture.png'},token,400)
    await call('images',{projectId:mod.id,operation:'apply',imageId:id,path:'../outside.png'},token,400)
    check('image apply refuses overwrite and project traversal',true)
    await images.images({projectId:mod.id,operation:'remove',imageId:id},true)
    const removedReceipt=await new MobileAssets(workspace,{}).images({projectId:mod.id,operation:'status',requestId:firstReceipt},true)
    const removedRepeat=await images.images({projectId:mod.id,operation:'generate',prompt:'decoder fixture',requestId:firstReceipt},true)
    check('removed image receipts remain terminal and cannot invite a duplicate generation',removedReceipt.task.status==='removed'&&removedRepeat.status==='removed'&&requests===2)
    check('history removal leaves applied project textures intact',Boolean(await fs.stat(path.join(workspace.projectsRoot,mod.id,'src/main/resources/assets/phone_test/textures/item/fixture.png'))))
    await fs.writeFile(path.join(root,'images',mod.id,'task.json'),JSON.stringify({id:'interrupted-fixture',status:'running'}))
    const recovered=await new MobileAssets(workspace,{}).images({operation:'list',projectId:mod.id},true)
    check('interrupted image requests are retained without charging an automatic retry',recovered.task.status==='interrupted'&&requests===2)
  } finally {imageFixture.closeAllConnections();await new Promise(resolve=>imageFixture.close(resolve))}
  console.log(JSON.stringify({ passed: checked, root }))
  await fs.writeFile(path.join(parent, 'backend-verification.json'), JSON.stringify({ passed: checked, verifiedAt: new Date().toISOString() }, null, 2))
} finally { await new Promise(resolve => server.close(resolve)); server.closeAllConnections() }
