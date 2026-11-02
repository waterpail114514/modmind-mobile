import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),run=promisify(execFile)
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe'
await run(adb,['-d','push',path.join(root,'android/runtime-paths.c'),'/data/local/tmp/modmind-runtime-paths.c'])
await run(adb,['-d','shell','run-as','com.termux','env','PREFIX=/data/data/com.termux/files/usr','PATH=/data/data/com.termux/files/usr/bin:/system/bin','LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib','/data/data/com.termux/files/usr/bin/clang','-shared','-fPIC','-O2','/data/local/tmp/modmind-runtime-paths.c','-o','/data/data/com.termux/files/home/libmm_runtime_paths.so','-ldl'])
await run(adb,['-d','shell','run-as com.termux cat files/home/libmm_runtime_paths.so > /data/local/tmp/libmm_runtime_paths.so'])
const target=path.join(root,'android/app/src/main/jniLibs/arm64-v8a/libmm_runtime_paths.so');await fs.mkdir(path.dirname(target),{recursive:true})
await run(adb,['-d','pull','/data/local/tmp/libmm_runtime_paths.so',target]);console.log('Built the APK JDK path adapter')
