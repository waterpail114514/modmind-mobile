import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.dirname(root)
const require = createRequire(path.join(repo, 'package.json'))
const esbuild = require('esbuild')
const dist = path.join(root, 'dist'), runtime = path.join(dist, 'runtime')
await fs.mkdir(runtime, { recursive: true })
await import('./prepare-desktop-ai.mjs')
const result = await esbuild.build({ entryPoints: [path.join(root, 'backend/server.ts')], outfile: path.join(runtime, 'server.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: true, metafile: true, banner: { js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);" }, external: ['electron', 'sharp', '7zip-bin', 'ffmpeg-static'], logLevel: 'warning' })
const bundledModules = new Set(Object.keys(result.metafile.inputs).map(file => path.resolve(repo, file)))
await fs.writeFile(path.join(dist, 'backend-metafile.json'), JSON.stringify(result.metafile, null, 2))
await fs.copyFile(path.join(repo, 'modmind-mcp-open-source/src/mcp-server.mjs'), path.join(runtime, 'mcp-server.mjs'))
for (const name of ['gradlew', 'gradle-wrapper.jar']) await fs.copyFile(path.join(repo, 'vendor/gradle-wrapper', name), path.join(runtime, name))
await fs.writeFile(path.join(dist, 'runtime.tar.gz'), gzipSync(execFileSync('tar', ['-cf', '-', '-C', runtime, '.'], { maxBuffer: 16 * 1024 * 1024 }), { level: 9 }))
const runtimeBytes = await fs.readFile(path.join(dist, 'runtime.tar.gz'))
if (runtimeBytes.length > 16 * 1024 * 1024) throw new Error('本地运行包超过 16 MiB')
const yazl = require('yazl'), codeZip = new yazl.ZipFile()
for (const name of await fs.readdir(runtime)) codeZip.addFile(path.join(runtime, name), name)
const codeChunks = []; codeZip.outputStream.on('data', chunk => codeChunks.push(chunk))
const codeDone = new Promise((resolve, reject) => { codeZip.outputStream.on('end', resolve); codeZip.outputStream.on('error', reject) }); codeZip.end(); await codeDone
await fs.writeFile(path.join(dist, 'runtime-code.zip'), Buffer.concat(codeChunks))
await fs.writeFile(path.join(dist, 'runtime-version.json'), JSON.stringify({ sha256: createHash('sha256').update(runtimeBytes).digest('hex'), bytes: runtimeBytes.length }))
if (!process.argv.includes('--backend-only')) {
  const webOutput = path.resolve(dist, 'web')
  if (webOutput !== path.join(root, 'dist/web')) throw new Error('Unsafe generated web path')
  await fs.rm(webOutput, { recursive: true, force: true })
  const webFiles = new Set()
  const { build } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  await build({ root, configFile: false, base: './', plugins: [react(), { name: 'mobile-bundled-notices', generateBundle() { for (const id of this.getModuleIds()) bundledModules.add(id) }, writeBundle(_options, bundle) { for (const name of Object.keys(bundle)) webFiles.add(name) } }], resolve: { alias: { react: path.join(repo, 'node_modules/react'), 'react-dom': path.join(repo, 'node_modules/react-dom'), 'lucide-react': path.join(repo, 'node_modules/lucide-react') } }, build: { outDir: webOutput, emptyOutDir: true, minify: true, chunkSizeWarningLimit: 700 } })
  await fs.writeFile(path.join(dist, 'web-manifest.json'), JSON.stringify([...webFiles].sort(), null, 2))
  const assets = path.join(root, 'android/app/src/main/assets')
  await fs.mkdir(assets, { recursive: true })
  await fs.copyFile(path.join(dist, 'runtime-code.zip'), path.join(assets, 'runtime-code.zip'))
  const generatedWeb = path.resolve(assets, 'web')
  if (generatedWeb !== path.join(root, 'android/app/src/main/assets/web')) throw new Error('Unsafe generated assets path')
  await fs.rm(generatedWeb, { recursive: true, force: true })
  for (const name of webFiles) {
    if (path.isAbsolute(name) || name.split('/').includes('..')) throw new Error('Unsafe bundled web file')
    const target = path.join(generatedWeb, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(webOutput, name), target)
  }
  await fs.rm(path.join(assets, 'runtime.tar.gz'), { force: true })
  // AAPT expands and renames .gz assets. Keep the compressed bytes under a neutral extension.
  await fs.copyFile(path.join(dist, 'runtime.tar.gz'), path.join(assets, 'runtime.bin'))
  const packages = new Set()
  for (const file of bundledModules) {
    const normalized = file.replaceAll('\\', '/'), marker = normalized.lastIndexOf('/node_modules/')
    if (marker < 0) continue
    const tail = normalized.slice(marker + 14).split('/'), count = tail[0].startsWith('@') ? 2 : 1
    packages.add(normalized.slice(0, marker + 14) + tail.slice(0, count).join('/'))
  }
  let notices = 'ModMind Android pilot — AGPL-3.0-only\n\n' + await fs.readFile(path.join(repo, 'LICENSE'), 'utf8')
  for(const name of await fs.readdir(path.join(root,'licenses')))notices+='\n\n===== '+name+' =====\n'+await fs.readFile(path.join(root,'licenses',name),'utf8')
  for (const directory of [...packages].sort()) {
    const metadata = await fs.readFile(path.join(directory, 'package.json'), 'utf8').then(JSON.parse).catch(() => null)
    if (!metadata) continue
    notices += `\n\n===== ${metadata.name} ${metadata.version} (${metadata.license || 'see upstream license'}) =====\n`
    for (const name of await fs.readdir(directory)) if (/^(?:licen[cs]e|copying|notice)(?:\..*)?$/i.test(name) && (await fs.stat(path.join(directory, name))).isFile()) notices += '\n' + await fs.readFile(path.join(directory, name), 'utf8')
  }
  await fs.writeFile(path.join(assets, 'THIRD_PARTY_NOTICES.txt'), notices)
  const drawable = path.join(root, 'android/app/src/main/res/drawable')
  await fs.mkdir(drawable, { recursive: true })
  await fs.copyFile(path.join(repo, 'resources/icon.png'), path.join(drawable, 'modmind.png'))
}
console.log(JSON.stringify({ runtimeBytes: runtimeBytes.length, bundledBackend: 'dist/runtime/server.mjs' }))
