// Input archive comes from npm's official platform package; verify before unpacking.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(root)
const descriptor=JSON.parse(await fs.readFile(path.join(repo,'src/main/codexRuntimeDescriptors.json'),'utf8'))
const target=descriptor.targets.find(t=>t.id==='linux-arm64')
const archive=process.argv[2];if(!archive)throw Error('Pass the downloaded official npm ARM64 archive as the first argument')
const bytes=await fs.readFile(archive)
if(createHash('sha512').update(bytes).digest('hex')!==target.sha512)throw Error('Codex archive does not match the desktop pinned descriptor')
const stage=path.join(root,'state/codex-'+descriptor.version);await fs.mkdir(stage,{recursive:true})
execFileSync('tar',['-xf',path.resolve(archive),'-C',stage,target.executableRelativePath])
const binary=await fs.readFile(path.join(stage,target.executableRelativePath))
if(binary.subarray(0,4).toString('hex')!=='7f454c46'||binary.readUInt16LE(18)!==183)throw Error('Codex must be an ARM64 ELF binary')
const destination=path.join(root,'android/app/src/main/jniLibs/arm64-v8a/libmm_codex_exec.so');await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,binary)
console.log(JSON.stringify({version:descriptor.version,archiveSha512:target.sha512,binaryBytes:binary.length,binarySha256:createHash('sha256').update(binary).digest('hex')}))
