import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { modTemplateFiles } from '../../feature-plugins/studio-mod/src/main/modTemplates'
import { createModpackManifest, writeModpackManifest, readModpackManifest, addModpackFiles, removeModpackFile, writeModrinthPackArchive } from '../../src/main/modpackService'
import { scopedFilePath } from '../../src/main/scopedFilePath'
import { serializeProjectMutation } from '../../src/main/projectMutation'
import { modpackOverridesRoot } from '../../src/main/modpackPaths'
import { validateProjectNameInput } from '../../src/shared/projectName'
import type { ProjectInfo } from '../../src/shared/types'
import type { Artifact, Document, Project, Task } from '../src/types'

const TEXT_LIMIT = 256 * 1024
const HIDDEN = new Set(['.gradle', '.git', '.modmind', '.mobile-history', 'node_modules', 'build', 'run', 'run-server', 'exports'])
const TEXT = /\.(?:bbmodel|java|json|json5|snbt|mcmeta|zs|toml|properties|gradle|kts|md|txt|mcfunction|lang|cfg|conf|yaml|yml|js|ts|xml)$/i
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export class WorkspaceError extends Error { constructor(public code: string, message: string) { super(message) } }
const fail = (code: string, message: string): never => { throw new WorkspaceError(code, message) }
const safeId = (value: string) => /^[a-f0-9-]{36}$/.test(value) || fail('PROJECT_SCOPE', '项目标识无效')
const safeFile = (relative: string) => {
  if (relative.replaceAll('\\', '/') === 'mobile.project.json') fail('FILE_TYPE', '应用项目索引由宿主管理，不能作为文本修改')
  if (!TEXT.test(relative) || relative.split(/[\\/]/).some(part => HIDDEN.has(part)) || /^gradle\//.test(relative)) fail('FILE_TYPE', '此位置不支持文本编辑')
}

export interface MobileOptions { root: string; runtime: string; gradleHome: string; javaHome?: string; downloadRoot?: string }
export class MobileWorkspace {
  get busy(){return this.buildStarting||this.children.size>0}
  buildPreferences=()=>({buildMemoryMb:1024,networkProxyUrl:'',gradleDownloadSource:'auto',offlineBuild:true})
  readonly projectsRoot: string
  readonly artifactsRoot: string
  private tasks = new Map<string, Task>()
  private children = new Map<string, ChildProcess>()
  private buildStarting = false
  private persistTail: Promise<unknown> = Promise.resolve()
  private taskWrites = new Map<string, NodeJS.Timeout>()

  constructor(readonly options: MobileOptions) {
    this.projectsRoot = path.join(options.root, 'projects')
    this.artifactsRoot = path.join(options.root, 'artifacts')
  }
  async initialize() {
    await fs.mkdir(this.projectsRoot, { recursive: true })
    await fs.mkdir(this.artifactsRoot, { recursive: true })
    const old: Task[] = await fs.readFile(path.join(this.options.root, 'tasks.json'), 'utf8').then(JSON.parse).catch(() => [])
    for (const task of old.slice(-16)) this.tasks.set(task.id, task.status === 'running' ? { ...task, status: 'interrupted', phase: '任务已中断，可重新执行', endedAt: new Date().toISOString() } : task)
    await this.persist()
  }
  private persist() {
    const snapshot = JSON.stringify([...this.tasks.values()].slice(-16), null, 2)
    this.persistTail = this.persistTail.catch(() => {}).then(async () => {
      const file = path.join(this.options.root, 'tasks.json')
      await fs.writeFile(file + '.pending', snapshot)
      await fs.rename(file + '.pending', file)
    })
    return this.persistTail
  }
  private directory(id: string) { safeId(id); return scopedFilePath(this.projectsRoot, id) }
  async project(id: string): Promise<Project & ProjectInfo> {
    const directory = await this.directory(id)
    const value = await fs.readFile(path.join(directory, 'mobile.project.json'), 'utf8').then(JSON.parse).catch(() => fail('PROJECT_MISSING', '找不到项目，请重新选择'))
    if (value.id !== id || !['mod', 'modpack'].includes(value.kind)) fail('PROJECT_SCOPE', '项目不属于安卓试验工作台')
    return { ...value, path: directory }
  }
  private publicProject(project: Project & ProjectInfo): Project { return { id: project.id, name: project.name, namespace: project.namespace, kind: project.kind as Project['kind'], loader: project.loader, minecraftVersion: project.minecraftVersion, createdAt: project.createdAt } }
  async list(kind?: string) {
    const entries = (await fs.readdir(this.projectsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).slice(0, 256)
    const projects: Project[] = []
    for (const entry of entries) {
      if (!/^[a-f0-9-]{36}$/.test(entry.name)) continue
      try { const project = await this.project(entry.name); if (!kind || project.kind === kind) projects.push(this.publicProject(project)) } catch { /* A broken project must not hide other projects. */ }
    }
    return { projects: projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  }
  async create(input: { name: string; kind: 'mod' | 'modpack'; namespace: string }) {
    if (!['mod', 'modpack'].includes(input.kind)) fail('STUDIO_UNSUPPORTED', '当前只提供模组制作和整合包制作')
    if (!/^[a-z][a-z0-9_]{1,47}$/.test(input.namespace)) fail('NAMESPACE', '标识使用小写字母、数字和下划线，以字母开头')
    if ((await this.list()).projects.length >= 256) fail('PROJECT_LIMIT', '试验版最多管理 256 个项目')
    const id = randomUUID(), directory = path.join(this.projectsRoot, id)
    const project = { id, path: directory, name: validateProjectNameInput(input.name), namespace: input.namespace, kind: input.kind, loader: 'fabric', minecraftVersion: '1.21.1', loaderVersion: '0.19.3', javaVersion: 21, createdAt: new Date().toISOString() } as Project & ProjectInfo
    await fs.mkdir(directory)
    try {
      if (project.kind === 'mod') {
        for (const [relative, content] of Object.entries(modTemplateFiles(project))) {
          const file = await scopedFilePath(directory, relative)
          await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content)
        }
        for (const [source, destination] of [['gradlew', 'gradlew'], ['gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.jar']]) await fs.copyFile(path.join(this.options.runtime, source), path.join(directory, destination))
        await fs.chmod(path.join(directory, 'gradlew'), 0o700)
        const properties = path.join(directory, 'gradle.properties')
        const text = await fs.readFile(properties, 'utf8')
        await fs.writeFile(properties, text.replace('org.gradle.parallel=true', 'org.gradle.parallel=false') + '\norg.gradle.workers.max=2\norg.gradle.daemon=false\norg.gradle.vfs.watch=false\n')
      } else {
        await fs.mkdir(path.join(directory, 'mods'))
        const overrides = modpackOverridesRoot(project)
        for (const folder of ['config', 'resourcepacks', 'datapacks']) await fs.mkdir(path.join(overrides, folder), { recursive: true })
        await fs.writeFile(path.join(directory, 'modmind.project.json'), JSON.stringify(project, null, 2))
        await writeModpackManifest(project, createModpackManifest(project))
        await fs.writeFile(path.join(overrides, 'config', 'README.txt'), '整合包配置文件放在这里。\n')
      }
      await fs.writeFile(path.join(directory, 'mobile.project.json'), JSON.stringify(project, null, 2))
      return this.publicProject(project)
    } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error }
  }
  async adopt(staging:string,input:{name:string;kind:'mod'|'modpack';namespace:string;loader:string;minecraftVersion:string}){
    const transferRoot=path.resolve(this.options.root,'transfers')+path.sep
    if(!path.resolve(staging).startsWith(transferRoot))throw new WorkspaceError('PROJECT_SCOPE','导入暂存位置无效')
    if((await this.list()).projects.length>=256)throw Error('最多管理 256 个项目')
    if(!['mod','modpack'].includes(input.kind)||!['fabric','quilt','forge','neoforge','bedrock','netease-pc','netease-mobile'].includes(input.loader)||!/^\d[\w.+-]{0,39}$/.test(input.minecraftVersion)||!/^[a-z][a-z0-9_]{1,47}$/.test(input.namespace))throw Error('项目描述中的平台、版本或标识无效')
    const id=randomUUID(),directory=path.join(this.projectsRoot,id)
    const project={id,path:directory,name:validateProjectNameInput(input.name),namespace:input.namespace,kind:input.kind,loader:input.loader,minecraftVersion:input.minecraftVersion,loaderVersion:'0.19.3',javaVersion:21,createdAt:new Date().toISOString()} as Project & ProjectInfo
    await fs.rename(staging,directory)
    try{
      if(project.kind==='mod'){
        const wrapper=path.join(directory,'gradle/wrapper');await fs.mkdir(wrapper,{recursive:true})
        if(!await fs.stat(path.join(wrapper,'gradle-wrapper.jar')).catch(()=>null))await fs.copyFile(path.join(this.options.runtime,'gradle-wrapper.jar'),path.join(wrapper,'gradle-wrapper.jar'))
        if(!await fs.stat(path.join(wrapper,'gradle-wrapper.properties')).catch(()=>null)&&project.loader==='fabric'&&project.minecraftVersion==='1.21.1')await fs.writeFile(path.join(wrapper,'gradle-wrapper.properties'),modTemplateFiles(project)['gradle/wrapper/gradle-wrapper.properties'])
      }else{
        const oldManifest=path.join(directory,'modmind.pack.json')
        if(await fs.stat(oldManifest).catch(()=>null))await fs.copyFile(oldManifest,path.join(directory,'modmind.desktop-pack.json'))
        await fs.mkdir(path.join(directory,'mods'),{recursive:true});await fs.mkdir(path.join(directory,'overrides'),{recursive:true})
        for(const folder of ['config','defaultconfigs','kubejs','scripts','resourcepacks','datapacks','patchouli_books','paxi','openloader']){
          const source=path.join(directory,folder),target=path.join(directory,'overrides',folder)
          if(await fs.stat(source).catch(()=>null)){if(await fs.stat(target).catch(()=>null))throw Error('根目录与 overrides 同时包含 '+folder+'，请整理归档后导入');await fs.rename(source,target)}
        }
        await writeModpackManifest(project,createModpackManifest(project))
        const jars=(await fs.readdir(path.join(directory,'mods'))).filter(n=>/\.jar$/i.test(n)).map(n=>path.join(directory,'mods',n));if(jars.length)await addModpackFiles(project,jars)
      }
      await fs.writeFile(path.join(directory,'modmind.project.json'),JSON.stringify(project,null,2))
      await fs.writeFile(path.join(directory,'mobile.project.json'),JSON.stringify(project,null,2))
      return this.publicProject(project)
    }catch(e){await fs.rm(directory,{recursive:true,force:true});throw e}
  }
  async rename(id:string,name:string){const project=await this.project(id);project.name=validateProjectNameInput(name);await fs.writeFile(path.join(project.path,'mobile.project.json'),JSON.stringify(project,null,2));await fs.writeFile(path.join(project.path,'modmind.project.json'),JSON.stringify(project,null,2));if(project.kind==='modpack'){const manifest=await this.managedPack(project);manifest.name=project.name;await writeModpackManifest(project,manifest)}return this.publicProject(project)}
  async delete(id:string){const project=await this.project(id);if([...this.tasks.values()].some(t=>t.projectId===id&&t.status==='running'))throw Error('请先停止此项目的构建');await fs.rm(await this.directory(id),{recursive:true,force:true});return {removed:true,id}}
  async files(id: string, relative = '', offset = 0) {
    const project = await this.project(id)
    const directory = relative ? await scopedFilePath(project.path, relative) : project.path
    const entries = (await fs.readdir(directory, { withFileTypes: true })).filter(entry => !entry.isSymbolicLink() && !HIDDEN.has(entry.name) && entry.name !== 'mobile.project.json')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    const page = await Promise.all(entries.slice(offset, offset + 100).map(async entry => {
      const stat = await fs.stat(path.join(directory, entry.name))
      return { name: entry.name, path: relative ? relative + '/' + entry.name : entry.name, directory: entry.isDirectory(), size: stat.size }
    }))
    return { entries: page, nextOffset: offset + 100 < entries.length ? offset + 100 : null, total: entries.length }
  }
  async read(id: string, relative: string): Promise<Document> {
    safeFile(relative)
    const project = await this.project(id), file = await scopedFilePath(project.path, relative)
    const stat = await fs.stat(file).catch(() => null)
    if (!stat) return { path: relative, content: '', revision: null, exists: false }
    if (!stat.isFile() || stat.size > TEXT_LIMIT) fail('FILE_LIMIT', '文本编辑上限为 256 KiB')
    const bytes = await fs.readFile(file)
    if (bytes.includes(0)) fail('FILE_TYPE', '此文件不是可编辑文本')
    return { path: relative, content: bytes.toString('utf8'), revision: hash(bytes), exists: true }
  }
  private saveOwned = serializeProjectMutation(async (project: Project & ProjectInfo, input: { path: string; content: string; revision: string | null; restore?: boolean }) => {
    safeFile(input.path)
    if (Buffer.byteLength(input.content) > TEXT_LIMIT) fail('FILE_LIMIT', '文本编辑上限为 256 KiB')
    const file = await scopedFilePath(project.path, input.path)
    const old = await this.read(project.id, input.path)
    if (old.revision !== input.revision) fail('CONFLICT', '文件已被其他操作修改。草稿已保留，请重新读取后比较')
    if (/\.(?:json|bbmodel)$/i.test(input.path)) { try { JSON.parse(input.content) } catch { fail('INVALID_JSON', 'JSON 格式有误，请修正后保存') } }
    const history = path.join(project.path, '.mobile-history')
    await fs.mkdir(history, { recursive: true })
    if (old.exists) await fs.writeFile(path.join(history, hash(input.path) + '.json'), JSON.stringify(old))
    const histories = await fs.readdir(history)
    if (histories.length > 32) {
      const sorted = await Promise.all(histories.map(async name => ({ name, time: (await fs.stat(path.join(history, name))).mtimeMs })))
      for (const oldEntry of sorted.sort((a, b) => a.time - b.time).slice(0, histories.length - 32)) await fs.unlink(path.join(history, oldEntry.name))
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    const target = await scopedFilePath(project.path, input.path), pending = target + '.pending-' + randomUUID()
    try { await fs.writeFile(pending, input.content, { flag: 'wx' }); await fs.rename(pending, target) }
    finally { await fs.rm(pending, { force: true }) }
    return this.read(project.id, input.path)
  })
  async save(id: string, input: { path: string; content: string; revision: string | null }) { return this.saveOwned(await this.project(id), input) }
  async restore(id: string, relative: string, revision: string | null) {
    const project = await this.project(id); safeFile(relative)
    const old = await fs.readFile(path.join(project.path, '.mobile-history', hash(relative) + '.json'), 'utf8').then(JSON.parse).catch(() => fail('NO_HISTORY', '此文件还没有可恢复的保存记录'))
    return this.saveOwned(project, { path: relative, content: old.content, revision })
  }
  async importMod(id: string, fileName: string, bytes: Buffer) {
    const project = await this.project(id)
    if (project.kind !== 'modpack') fail('STUDIO_UNSUPPORTED', '仅整合包项目支持导入模组 JAR')
    await this.managedPack(project)
    if (!/^[^/\\\0\r\n]+\.jar$/i.test(fileName) || bytes.length > 64 * 1024 * 1024) fail('IMPORT_LIMIT', '请选择不超过 64 MiB 的 JAR 文件')
    const temporary = path.join(this.options.root, 'import-' + randomUUID() + '.jar')
    await fs.writeFile(temporary, bytes)
    const namedDirectory = path.join(this.options.root, 'import-' + randomUUID())
    try {
      await fs.mkdir(namedDirectory); const namedFile = path.join(namedDirectory, fileName); await fs.rename(temporary, namedFile)
      return await addModpackFiles(project, [namedFile])
    } finally { await fs.rm(temporary, { force: true }); await fs.rm(namedDirectory, { force: true, recursive: true }) }
  }
  private async managedPack(project: Project & ProjectInfo) {
    const manifest = await readModpackManifest(project)
    if (manifest.modules.length || manifest.source && manifest.source.layout !== 'workspace') fail('PACK_SCOPE', '安卓试验版暂不支持关联模块或其他实例布局，请使用当前项目内的 mods 和 overrides')
    return manifest
  }
  async removeMod(id: string, fileName: string) {
    const project = await this.project(id)
    if (project.kind !== 'modpack') fail('STUDIO_UNSUPPORTED', '仅整合包项目支持移出模组')
    const manifest = await this.managedPack(project)
    if (!manifest.mods.some(mod => mod.fileName === fileName)) fail('MOD_MISSING', '此模组已不在当前整合包，请刷新文件列表')
    await scopedFilePath(project.path, 'mods/' + fileName)
    return removeModpackFile(project, fileName)
  }
  async pack(id: string) { return this.managedPack(await this.project(id)) }
  async artifact(projectId: string, file: string, move=false): Promise<Artifact> {
    if(projectId==='application')await scopedFilePath(path.join(this.options.root,'diagnostics'),path.relative(path.join(this.options.root,'diagnostics'),file).replaceAll('\\','/'))
    else {const project = await this.project(projectId);await scopedFilePath(project.path, path.relative(project.path, file).replaceAll('\\', '/'))}
    const previous = (await fs.readdir(this.artifactsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9-]{36}$/.test(entry.name))
    const ages = await Promise.all(previous.map(async entry => ({ id: entry.name, modified: (await fs.stat(path.join(this.artifactsRoot, entry.name))).mtimeMs })))
    for (const old of ages.sort((a, b) => b.modified - a.modified).filter((value, index) => index >= 31 || Date.now() - value.modified > 7 * 86400000)) await fs.rm(await scopedFilePath(this.artifactsRoot, old.id), { recursive: true, force: true })
    const id = randomUUID(), directory = path.join(this.artifactsRoot, id)
    await fs.mkdir(directory)
    const destination = path.join(directory, path.basename(file)); if(move)await fs.rename(file,destination);else await fs.copyFile(file, destination)
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(destination)) digest.update(chunk)
    const artifact = { id, projectId, name: path.basename(file), size: (await fs.stat(destination)).size, sha256: digest.digest('hex') }
    await fs.writeFile(path.join(directory, 'artifact.json'), JSON.stringify(artifact))
    return artifact
  }
  async artifactFile(id: string, projectId?: string) {
    safeId(id)
    const directory = await scopedFilePath(this.artifactsRoot, id)
    const artifact: Artifact = await fs.readFile(path.join(directory, 'artifact.json'), 'utf8').then(JSON.parse)
    if (artifact.id !== id || projectId && artifact.projectId !== projectId) fail('PROJECT_SCOPE', '产物不属于当前项目')
    const file = await scopedFilePath(directory, artifact.name)
    return { artifact, file }
  }
  async exportPack(id: string) {
    const project = await this.project(id)
    if (project.kind !== 'modpack') fail('STUDIO_UNSUPPORTED', '当前项目不是整合包')
    await this.managedPack(project)
    const target = path.join(project.path, 'exports', project.namespace + '-0.1.0.mrpack')
    await writeModrinthPackArchive(project, target, { version: '0.1.0', mode: 'bundled' })
    return this.artifact(id, target)
  }
  taskList(projectId: string) { return { tasks: [...this.tasks.values()].filter(task => task.projectId === projectId).reverse().slice(0, 8) } }
  async build(id: string, offline: boolean|undefined = undefined, command:'build'|'test'='build') {
    const project = await this.project(id)
    if (project.kind !== 'mod') fail('STUDIO_UNSUPPORTED', '整合包项目请使用导出整合包')
    if(project.loader!=='fabric'||project.minecraftVersion!=='1.21.1')throw Error('此项目可编辑；当前手机构建仅验证 Fabric 1.21.1，更多目标暂缓')
    if (this.children.size || this.buildStarting) fail('TASK_BUSY', '已有构建任务正在运行，请先完成或取消')
    this.buildStarting = true
    try {
    const task: Task = { id: randomUUID(), projectId: id, kind:command==='test'?'project-test':'build', status: 'running', phase:command==='test'?'正在执行项目测试':'正在构建', startedAt: new Date().toISOString(), log: '', artifacts: [] }
    this.tasks.set(task.id, task)
    while (this.tasks.size > 16) { const oldest = [...this.tasks.values()].find(value => value.status !== 'running'); if (!oldest) break; this.tasks.delete(oldest.id) }
    await this.persist()
    const javaHome = this.options.javaHome || process.env.JAVA_HOME || path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'lib/jvm/java-21-openjdk')
    // Invoke the official wrapper JAR directly: Android's toybox xargs does not
    // implement the quoted-argument handling expected by the desktop shell file.
    const preferences=this.buildPreferences(),proxy=preferences.networkProxyUrl?new URL(preferences.networkProxyUrl):undefined
    const child = spawn(path.join(javaHome, 'bin/java'), ['-Dfile.encoding=UTF-8', '-Xmx64m', '-Xms64m', '-Dorg.gradle.appname=gradlew', '-Dorg.gradle.jvmargs=-Xmx'+preferences.buildMemoryMb+'m -Dfile.encoding=UTF-8',...(proxy?['-Dhttp.proxyHost='+proxy.hostname,'-Dhttp.proxyPort='+(proxy.port||'80'),'-Dhttps.proxyHost='+proxy.hostname,'-Dhttps.proxyPort='+(proxy.port||'80')]:[]), '-jar', 'gradle/wrapper/gradle-wrapper.jar', command, ...(command==='test'?['--rerun-tasks']:[]), '--no-daemon', '--console=plain', '--max-workers=2', ...((offline??preferences.offlineBuild) ? ['--offline'] : [])], {
      cwd: project.path, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, JAVA_HOME: javaHome, GRADLE_USER_HOME: this.options.gradleHome, JAVA_TOOL_OPTIONS: (process.env.JAVA_TOOL_OPTIONS || '') + ' -Djava.awt.headless=true -Dsun.net.client.defaultConnectTimeout=30000 -Dsun.net.client.defaultReadTimeout=60000' }
    })
    this.children.set(task.id, child)
    const append = (bytes: Buffer) => {
      task.log = (task.log + bytes.toString('utf8')).slice(-32 * 1024)
      const phase = task.log.split(/\r?\n/).filter(line => line.startsWith('> Task ')).pop()
      if (phase) task.phase = phase.replace('> Task ', '')
      if (!this.taskWrites.has(task.id)) this.taskWrites.set(task.id, setTimeout(() => { this.taskWrites.delete(task.id); void this.persist() }, 1000))
    }
    child.stdout!.on('data', append); child.stderr!.on('data', append)
    child.once('error', error => { task.error = error.message })
    const timer = setTimeout(() => { task.error = '构建超过 20 分钟，已停止。可检查日志后重试'; this.stopChild(task.id) }, 20 * 60 * 1000)
    child.once('close', async code => {
      clearTimeout(timer)
      try {
        if (task.status === 'cancelled') return
        if (code !== 0) { task.status = 'failed'; task.phase = '构建失败'; task.error ||= offline && /offline|cached version|cached resource/i.test(task.log) ? '缺少离线构建依赖。请在构建页关闭“离线构建”后重试；首次下载可能需要数百 MB' : '构建未完成，请查看日志并修改后重试' }
        else {
          if(command==='test'){
            let count=0,failed=0,skipped=0,files=0
            const visit=async(folder:string)=>{for(const entry of await fs.readdir(folder,{withFileTypes:true}).catch(()=>[])){if(entry.isSymbolicLink()||files>=200)continue;const file=path.join(folder,entry.name);if(entry.isDirectory())await visit(file);else if(/^TEST-.*\.xml$/.test(entry.name)){const stat=await fs.stat(file);if(stat.size>512*1024||stat.mtimeMs<Date.parse(task.startedAt)-1000)continue;files++;const text=await fs.readFile(file,'utf8'),header=text.match(/<testsuite\b([^>]*)>/)?.[1]||'',attributes=Object.fromEntries([...header.matchAll(/\b(tests|failures|errors|skipped)="(\d+)"/g)].map(m=>[m[1],Number(m[2])])) as Record<string,number>;count+=attributes.tests||0;failed+=(attributes.failures||0)+(attributes.errors||0);skipped+=attributes.skipped||0}}}
            await visit(path.join(project.path,'build/test-results'))
            task.evidence={gameVerified:false,projectTests:count?failed?'failed':'passed':/:test\s+NO-SOURCE/.test(task.log)?'no_tests':'task_completed',count,failed,skipped}
            task.status=failed?'failed':'completed';task.phase=failed?'项目测试发现失败':count?'项目测试通过（'+count+' 项）':task.evidence.projectTests==='no_tests'?'项目未包含可执行测试':'任务完成，未获得测试报告'
          }else{
            const directory = path.join(project.path, 'build/libs')
            const names = (await fs.readdir(directory)).filter(name => name.endsWith('.jar') && !/(?:sources|javadoc|dev)\.jar$/.test(name)).slice(0, 4)
            if (!names.length) throw new Error('构建结束但没有找到模组 JAR')
            for (const name of names) task.artifacts.push(await this.artifact(id, path.join(directory, name)))
            task.status = 'completed'; task.phase = '构建完成';task.evidence={gameVerified:false}
          }
        }
      } catch (error) { task.status = 'failed'; task.phase = '产物收集失败'; task.error = String(error) }
      finally { this.children.delete(task.id); task.endedAt = new Date().toISOString(); await this.persist() }
    })
    return task
    } finally { this.buildStarting = false }
  }
  private stopChild(id: string) { const child = this.children.get(id); if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') } } }
  async cancel(projectId: string, taskId: string) {
    const task = this.tasks.get(taskId)
    if (!task || task.projectId !== projectId) throw new WorkspaceError('PROJECT_SCOPE', '任务不属于当前项目')
    if (task.status === 'running') { task.status = 'cancelled'; task.phase = '已取消'; task.endedAt = new Date().toISOString(); this.stopChild(taskId); await this.persist() }
    return task
  }
}
