import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import fs from 'node:fs/promises'
process.env.MODMIND_PACKAGE='dev.modmind';process.env.MODMIND_PHONE_PORT='19087'
const {phoneRpc}=await import('./phone-rpc.mjs')
const adb=process.env.ADB||'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe',run=promisify(execFile)
const project=(await phoneRpc('query',{operation:'projects'})).projects.find(p=>p.namespace==='independent_test')
const {stdout}=await run(adb,['-d','shell','run-as','dev.modmind','readlink','files/u/bin/java'])
const native=stdout.trim().replace(/\/[^/]+$/,''),prefix='/data/data/dev.modmind/files/u',jdk=prefix+'/lib/jvm/java-21-openjdk',root='/data/data/dev.modmind/files/home/.modmind-mobile'
const child=spawn(adb,['-d','shell','run-as','dev.modmind','env','HOME=/data/data/dev.modmind/files/home','PREFIX='+prefix,'PATH='+prefix+'/bin:/system/bin','JAVA_HOME='+jdk,'LD_LIBRARY_PATH='+native+':'+prefix+'/lib:'+jdk+'/lib:'+jdk+'/lib/server','LD_PRELOAD='+native+'/libmm_runtime_paths.so','GRADLE_USER_HOME='+root+'/gradle-cache','TMPDIR='+prefix+'/tmp','JAVA_TOOL_OPTIONS=-Djava.io.tmpdir='+prefix+'/tmp',jdk+'/bin/java','-Dfile.encoding=UTF-8','-Xmx64m','-Xms64m','-jar',root+'/projects/'+project.id+'/gradle/wrapper/gradle-wrapper.jar','--project-dir',root+'/projects/'+project.id,'build','--offline','--no-daemon','--console=plain','--max-workers=2'],{stdio:['ignore','pipe','pipe']})
let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{log+=data.toString();process.stdout.write(data)})
const code=await new Promise(resolve=>child.on('exit',resolve));await fs.writeFile('test-results/independent/wrapper-probe.json',JSON.stringify({code,log},null,2));process.exitCode=code||0
