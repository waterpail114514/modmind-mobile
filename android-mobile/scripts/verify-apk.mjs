import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(path.dirname(root), 'package.json'))
const yauzl = require('yauzl')
const apk = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk')
const entries = new Map()
const nativeHashes = new Map()
await new Promise((resolve, reject) => yauzl.open(apk, { lazyEntries: true }, (error, zip) => {
  if (error) return reject(error)
  zip.on('error', reject); zip.on('end', resolve)
  zip.on('entry', entry => {
    if(entry.fileName.startsWith('lib/arm64-v8a/')){
      zip.openReadStream(entry,(error,input)=>{
        if(error)return reject(error)
        const hash=createHash('sha256');input.on('data',bytes=>hash.update(bytes));input.on('error',reject)
        input.on('end',()=>{nativeHashes.set(entry.fileName,hash.digest('hex'));zip.readEntry()})
      });return
    }
    if (!entry.fileName.startsWith('assets/')) return zip.readEntry()
    zip.openReadStream(entry, (error, input) => {
      if (error) return reject(error)
      const chunks = []; input.on('data', bytes => chunks.push(bytes)); input.on('error', reject)
      input.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry() })
    })
  }); zip.readEntry()
}))
assert.deepEqual(entries.get('assets/runtime.bin'), await fs.readFile(path.join(root, 'dist/runtime.tar.gz')), 'APK must retain the exact compressed runtime bytes')
assert.deepEqual(entries.get('assets/runtime-code.zip'),await fs.readFile(path.join(root,'dist/runtime-code.zip')),'native runtime must install the exact built code')
const nativeRoot=path.join(root,'android/app/src/main/jniLibs/arm64-v8a'),nativeFiles=(await fs.readdir(nativeRoot)).filter(name=>name.endsWith('.so'))
assert.equal(nativeHashes.size,nativeFiles.length,'all packaged native components must be present')
for(const name of nativeFiles)assert.equal(nativeHashes.get('lib/arm64-v8a/'+name),createHash('sha256').update(await fs.readFile(path.join(nativeRoot,name))).digest('hex'),'native ELF must not be stripped or changed: '+name)
for(const name of ['libmm_node_exec.so','libmm_java_exec.so','libmm_javac_exec.so','libmm_codex_exec.so','libmm_runtime_paths.so'])assert.ok(nativeHashes.has('lib/arm64-v8a/'+name),'missing native tool '+name)
assert.ok(entries.get('assets/THIRD_PARTY_NOTICES.txt')?.toString('utf8').includes('@codemirror/view'), 'bundled licenses are required')
const html = entries.get('assets/web/index.html')?.toString('utf8'); assert.ok(html)
for (const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) assert.ok(entries.has('assets/web/' + match[1]), 'missing web entry ' + match[1])
const names = JSON.parse(await fs.readFile(path.join(root, 'dist/web-manifest.json'), 'utf8'))
assert.deepEqual([...entries.keys()].filter(name => name.startsWith('assets/web/')).sort(), names.map(name => 'assets/web/' + name).sort(), 'only files emitted by this build may enter the APK')
const bytes = await fs.readFile(apk)
console.log(JSON.stringify({ apkBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), runtimeBytes: entries.get('assets/runtime.bin').length, verifiedAssets: entries.size,verifiedNativeLibraries:nativeHashes.size }, null, 2))
