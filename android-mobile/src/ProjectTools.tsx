import ArtifactResult from './ArtifactResult'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Box, Check, ChevronRight, FileCode2, FilePlus2, Folder, FolderOpen, Hammer, Layers3, LoaderCircle, Moon, Package, Plus, RotateCcw, Save, Search, Sun, Upload, X, CircleAlert, RefreshCw, Download, ListChecks, MoreHorizontal } from 'lucide-react'
import { useConfirmDialog, usePromptDialog } from '../../src/renderer/src/components/InteractionDialogs'
import { native, rpc } from './bridge'
import {waitJob} from './jobs'
import VerificationReport from './VerificationReport'
import type { Artifact, Document, FileEntry, Project, Task } from './types'
const CodeEditor = lazy(() => import('./CodeEditor'))

const MESSAGE = (error: unknown) => error instanceof Error ? error.message : String(error)
const SIZE = (bytes: number) => bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024 ? Math.ceil(bytes / 1024) + ' KiB' : (bytes / 1024 / 1024).toFixed(1) + ' MiB'
const draftKey = 'modmind.mobile.drafts'
type Draft = { projectId: string; path: string; content: string; revision: string | null; at: number }
const readDrafts = (): Draft[] => { try { return JSON.parse(localStorage.getItem(draftKey) || '[]').slice(0, 4) } catch { return [] } }
const storeDraft = (draft: Draft, remove = false) => {
  const old = readDrafts().filter(value => !(value.projectId === draft.projectId && value.path === draft.path))
  try { localStorage.setItem(draftKey, JSON.stringify((remove ? old : [draft, ...old]).slice(0, 4))) } catch { /* Keep the live editor when storage is full. */ }
}
function phase(task: Task) {
  if (task.status !== 'running') return task.phase
  if (/compile/i.test(task.phase)) return '编译代码'
  if (/remap/i.test(task.phase)) return '处理模组映射'
  if (/jar|resources/i.test(task.phase)) return '打包模组'
  return '正在构建'
}

export default function ProjectTools({project,initialScreen='files',initialPath,readOnly=false,onOpenModel}:{project:Project;initialScreen?:'files'|'tasks';initialPath?:string;readOnly?:boolean;onOpenModel(path:string):void}) {
  const [screen,setScreen]=useState<'files'|'editor'|'tasks'>(initialScreen),[directory,setDirectory]=useState(''),[entries,setEntries]=useState<FileEntry[]>([])
  const [nextOffset,setNextOffset]=useState<number|null>(null),[filter,setFilter]=useState(''),[doc,setDoc]=useState<Document|null>(null),[content,setContent]=useState('')
  const [tasks,setTasks]=useState<Task[]>([]),[artifacts,setArtifacts]=useState<Artifact[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[offline,setOffline]=useState(true)
  const [report,setReport]=useState<any>(),[checking,setChecking]=useState<any>(),[searchResults,setSearchResults]=useState<any[]|null>(null)
  const [dark]=useState(document.documentElement.dataset.themeMode==='dark')
  const confirmDialog=useConfirmDialog(),promptDialog=usePromptDialog()
  const sequence=useRef(0),projectRef=useRef(project),docRef=useRef(doc),contentRef=useRef(content)
  projectRef.current=project;docRef.current=doc;contentRef.current=content
  const dirty=Boolean(doc&&content!==doc.content),ready=true
  const retainDraft = useCallback(() => {
    if (projectRef.current && docRef.current && contentRef.current !== docRef.current.content) storeDraft({ projectId: projectRef.current.id, path: docRef.current.path, content: contentRef.current, revision: docRef.current.revision, at: Date.now() })
  }, [])
  const guard = useCallback(async () => {
    if (!docRef.current || contentRef.current === docRef.current.content) return true
    const proceed = await confirmDialog.confirm({ title: '保留草稿并离开？', message: '当前文件还没有保存，草稿会保留在这部手机。', confirmLabel: '保留草稿并离开', cancelLabel: '继续编辑', actionIcon: 'continue' })
    if (proceed) retainDraft()
    return proceed
  }, [confirmDialog.confirm, retainDraft])
  useEffect(() => { const timer = setTimeout(retainDraft, 350); return () => clearTimeout(timer) }, [content, retainDraft])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer) }, [notice])
  useEffect(() => { const handler = () => retainDraft(); document.addEventListener('visibilitychange', handler); return () => document.removeEventListener('visibilitychange', handler) }, [retainDraft])
  const loadFiles = useCallback(async (selected: Project, relative: string, offset = 0) => {
    const requestId = ++sequence.current; setLoading(true)
    try {
      const result = await rpc<{ entries: FileEntry[]; nextOffset: number | null }>('query', { operation: 'files', projectId: selected.id, path: relative, offset })
      if (requestId !== sequence.current || projectRef.current?.id !== selected.id) return
      setEntries(old => offset ? [...old, ...result.entries] : result.entries); setNextOffset(result.nextOffset)
    } catch (reason) { if (requestId === sequence.current) setError(MESSAGE(reason)) } finally { if (requestId === sequence.current) setLoading(false) }
  }, [])
  useEffect(() => { if (project && ready && screen === 'files') void loadFiles(project, directory) }, [project, ready, screen, directory, loadFiles])
  useEffect(() => {
    if (!project || !ready) return
    let alive = true, timer: ReturnType<typeof setTimeout>
    const poll = async () => { try { const result = await rpc<{ tasks: Task[] }>('query', { operation: 'tasks', projectId: project.id }); if (alive) { setTasks(result.tasks); if (result.tasks.some(task => task.status === 'running')) timer = setTimeout(poll, 1200) } } catch (reason) { if (alive) setError(MESSAGE(reason)) } }
    void poll(); return () => { alive = false; clearTimeout(timer) }
  }, [project, ready, screen, busy])
  useEffect(()=>{window.__modmindToolGuard=guard;window.__modmindToolBack=()=>{if(screen==='editor'){void guard().then(ok=>{if(ok)setScreen('files')});return true}if(screen==='files'&&directory){setDirectory(directory.split('/').slice(0,-1).join('/'));return true}return false};return()=>{delete window.__modmindToolBack;delete window.__modmindToolGuard}},[screen,directory,guard])
  const openFile = async (entry: FileEntry) => {
    if(/\.bbmodel$/i.test(entry.path)&&!initialPath){onOpenModel(entry.path);return}
    if (entry.directory) { setDirectory(entry.path); setFilter(''); return }
    const selected = project!
    setBusy('read'); setError('')
    try {
      const document = await rpc<Document>('query', { operation: 'read', projectId: selected.id, path: entry.path })
      if (projectRef.current?.id !== selected.id) return
      const cached = readDrafts().find(value => value.projectId === selected.id && value.path === entry.path)
      setDoc(cached ? { ...document, revision: cached.revision } : document); setContent(cached?.content ?? document.content); setScreen('editor')
      if (cached) setNotice('已恢复本机草稿')
    } catch (reason) { setError(MESSAGE(reason)) } finally { setBusy('') }
  }
  useEffect(()=>{if(initialPath)void openFile({name:initialPath.split('/').pop()!,path:initialPath,directory:false,size:0})},[initialPath])
  const save = async () => {
    if (!doc || !project) return false
    setBusy('save'); setError('')
    try { const saved = await rpc<Document>('write', { operation: 'save', projectId: project.id, path: doc.path, content, revision: doc.revision }); setDoc(saved); setContent(saved.content); storeDraft({ projectId: project.id, path: doc.path } as Draft, true); return true }
    catch (reason) { retainDraft(); setError(MESSAGE(reason)); return false } finally { setBusy('') }
  }
  const newFile = async () => {
    const file = await promptDialog.prompt({ title: '新建文本文件', inputLabel: '文件名或相对路径', placeholder: '例如 config/example.json', confirmLabel: '打开编辑' })
    if (!file?.trim()) return
    if(/\.bbmodel$/i.test(file)){const relative=directory?directory+'/'+file:file;await rpc('models',{operation:'create',projectId:project.id,path:relative}).then(()=>onOpenModel(relative)).catch(reason=>setError(MESSAGE(reason)));return}
    await openFile({ name: file, path: directory ? directory + '/' + file : file, directory: false, size: 0 })
  }
  const download = async (artifact: Artifact) => { setBusy('download'); setError(''); try { const result = await native('export', { artifactId: artifact.id }); setNotice('已保存到' + result.location) } catch (reason) { setError(MESSAGE(reason)) } finally { setBusy('') } }
  const checkProject=async()=>{setBusy('check');setScreen('tasks');setError('');try{const job=await rpc<any>('project',{operation:'check',projectId:project.id});setChecking(job);setReport(await waitJob(job.id,setChecking))}catch(e){setError(MESSAGE(e))}finally{setBusy('');setChecking(undefined)}}
  const runProjectTests=async()=>{if(dirty&&!await save())return;setBusy('test');setScreen('tasks');setError('');try{const task=await rpc<Task>('task',{operation:'test',projectId:project.id,offline});setTasks(old=>[task,...old])}catch(e){setError(MESSAGE(e))}finally{setBusy('')}}
  const searchProject=async()=>{if(!filter.trim()){setSearchResults(null);return}setBusy('search');setError('');try{const result=await rpc<any>('project',{operation:'search',projectId:project.id,query:filter,content:true});setSearchResults(result.matches);if(result.truncated)setNotice('显示前 100 条或已扫描 8 MiB，请缩小搜索范围')}catch(e){setError(MESSAGE(e))}finally{setBusy('')}}
  const moveFile=async()=>{if(!doc)return;if(dirty&&!await save())return;const to=await promptDialog.prompt({title:'移动或重命名文件',inputLabel:'新项目相对路径',value:doc.path,confirmLabel:'移动文件'});if(!to||to===doc.path)return;setBusy('move');setError('');try{const current=await rpc<Document>('query',{operation:'read',projectId:project.id,path:doc.path});await rpc('project',{operation:'move',projectId:project.id,path:doc.path,to,revision:current.revision});storeDraft({projectId:project.id,path:doc.path} as Draft,true);await openFile({name:to.split('/').pop()!,path:to,directory:false,size:0})}catch(e){setError(MESSAGE(e))}finally{setBusy('')}}
  const deleteFile=async()=>{if(!doc||!await confirmDialog.confirm({title:'移除 '+doc.path.split('/').pop()+'？',message:'先保存未提交的编辑并建立恢复点，再移除此文件。',confirmLabel:'移除文件',tone:'danger'}))return;if(dirty&&!await save())return;setBusy('delete');setError('');try{const current=await rpc<Document>('query',{operation:'read',projectId:project.id,path:doc.path});await rpc('project',{operation:'remove_file',projectId:project.id,path:doc.path,revision:current.revision,confirmed:true});storeDraft({projectId:project.id,path:doc.path} as Draft,true);setDoc(null);setScreen('files');await loadFiles(project,directory)}catch(e){setError(MESSAGE(e))}finally{setBusy('')}}
  useEffect(()=>{if(screen==='tasks')void rpc<any>('job',{operation:'list',projectId:project.id}).then(value=>{const previous=value.jobs.find((j:any)=>j.title==='检查项目'&&j.status==='completed');if(previous)setReport(previous.result)}).catch(()=>{})},[screen,project.id])
  const build = async () => {
    if (!project) return
    if (dirty && !await confirmDialog.confirm({ title: '保存文件并构建？', message: '构建会使用保存后的项目内容。', confirmLabel: '保存并构建', actionIcon: 'continue' })) return
    if (dirty && !await save()) return
    setBusy('build'); setError(''); setScreen('tasks')
    try { const task = await rpc<Task>('task', { operation: 'build', projectId: project.id, offline }); setTasks(old => [task, ...old.filter(value => value.id !== task.id)]) }
    catch (reason) { setError(MESSAGE(reason)) } finally { setBusy('') }
  }
  const exportPack = async () => { setBusy('export'); setError(''); try { const artifact = await rpc<Artifact>('write', { operation: 'export', projectId: project!.id }); setArtifacts(old => [artifact, ...old].slice(0, 4)); await download(artifact) } catch (reason) { setError(MESSAGE(reason)) } finally { setBusy('') } }
  const importMod = async () => { setBusy('import'); setError(''); try { await native('pickMod', { projectId: project!.id }); await loadFiles(project!, directory); setNotice('文件选择已结束，已导入的模组保存在 mods') } catch (reason) { setError(MESSAGE(reason)) } finally { setBusy('') } }
  const restore = async () => {
    if (!doc || !await confirmDialog.confirm({ title: '恢复上次保存前的内容？', message: '当前内容会保留为下一次可恢复记录。', confirmLabel: '恢复文件', actionIcon: 'restore' })) return
    setBusy('restore'); setError('')
    try { const restored = await rpc<Document>('write', { operation: 'restore', projectId: project!.id, path: doc.path, revision: doc.revision }); setDoc(restored); setContent(restored.content); setNotice('已恢复文件') } catch (reason) { setError(MESSAGE(reason)) } finally { setBusy('') }
  }
  const reloadFile = async () => {
    if (!doc || !project) return
    if (dirty && !await confirmDialog.confirm({ title: '重新读取并放弃草稿？', message: '载入文件的最新保存内容，当前未保存的草稿会被清除。', confirmLabel: '放弃草稿并读取', cancelLabel: '继续编辑', actionIcon: 'continue' })) return
    setBusy('read'); setError('')
    try {
      const latest = await rpc<Document>('query', { operation: 'read', projectId: project.id, path: doc.path })
      setDoc(latest); setContent(latest.content); storeDraft({ projectId: project.id, path: doc.path } as Draft, true); setNotice('已读取最新内容')
    } catch (reason) { setError(MESSAGE(reason)) } finally { setBusy('') }
  }
  const running = tasks.find(task => task.status === 'running')
  const visible = entries.filter(entry => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
  const removeMod = async (entry: FileEntry) => {
    if (!await confirmDialog.confirm({ title: '移出 ' + entry.name + '？', message: '仅移出当前整合包。原始导入文件仍保留，需要时可以重新导入。', confirmLabel: '移出整合包', cancelLabel: '保留模组', tone: 'danger', actionIcon: 'delete' })) return
    setBusy('remove'); setError('')
    try { await rpc('write', { operation: 'remove_mod', projectId: project!.id, fileName: entry.name }); await loadFiles(project!, directory); setNotice('已移出整合包') }
    catch (reason) { setError(MESSAGE(reason)) } finally { setBusy('') }
  }
  const renderEntry = (entry: FileEntry) => {
    const body = <>{entry.directory ? <Folder size={21} /> : <FileCode2 size={21} />}<span>{entry.name}</span>{entry.directory ? <ChevronRight size={17} /> : <small>{SIZE(entry.size)}</small>}</>
    if (!readOnly && project?.kind === 'modpack' && entry.path === 'mods/' + entry.name && /\.jar$/i.test(entry.name)) return <details className="pack-jar" key={entry.path}><summary className="file-row">{body}<ChevronRight size={17} /></summary><button className="text-button" disabled={Boolean(busy)} onClick={() => { void removeMod(entry) }}>移出整合包</button></details>
    return <button className="file-row" key={entry.path} disabled={busy === 'read'} onClick={() => { void openFile(entry) }}>{body}</button>
  }

  return <section className="project-tools">
    {error?<p className="inline-error" role="alert">{error}<button className="icon-button" aria-label="关闭错误" onClick={()=>setError('')}><X size={16}/></button></p>:null}
    {notice?<p className="inline-notice" role="status">{notice}</p>:null}
    <div className="tool-body">{screen === 'files' ? <><div className="file-toolbar"><button className="path-button" disabled={!directory} onClick={() => { setDirectory(directory.split('/').slice(0, -1).join('/')); setFilter('') }}>{directory ? <ArrowLeft size={16} /> : <FolderOpen size={17} />}<span>{directory || '项目文件'}</span></button><button className="icon-button" aria-label="刷新文件" disabled={loading || Boolean(busy)} onClick={() => { setError(''); void loadFiles(project, directory) }}><RefreshCw size={19} /></button><button hidden={readOnly} className="icon-button" aria-label="新建文件" onClick={() => { void newFile() }}><FilePlus2 size={20} /></button>{project.kind === 'modpack' && !readOnly ? <button className="icon-button" aria-label="导入模组 JAR" disabled={Boolean(busy)} onClick={() => { void importMod() }}><Upload size={20} /></button> : null}</div><label className="file-search"><Search size={17} /><input aria-label="筛选已载入文件" placeholder="筛选已载入文件" value={filter} onChange={event => {setFilter(event.target.value);setSearchResults(null)}} /><button className="icon-button" aria-label="搜索项目内容" disabled={Boolean(busy)} onClick={()=>void searchProject()}><Search size={18}/></button></label><div className="file-list" aria-busy={loading}>{searchResults?searchResults.map((result,i)=><button className="file-row search-result" key={result.path+':'+i} onClick={()=>void openFile({name:result.path.split('/').pop()!,path:result.path,directory:false,size:0})}><span>{result.path}{result.line?':'+result.line:''}<small>{result.text}</small></span></button>):visible.map(renderEntry)}{loading ? <div className="loading-row"><LoaderCircle size={18} className="spin" />正在读取文件</div> : !(searchResults?searchResults.length:visible.length) ? <div className="empty"><FolderOpen size={28} /><p>{filter ? '没有匹配文件' : '此目录还没有文件'}</p></div> : null}{nextOffset !== null && !searchResults ? <button className="load-more" onClick={() => { void loadFiles(project, directory, nextOffset) }}>载入更多文件</button> : null}</div></>
                : screen === 'editor' && doc ? <><div className="editor-toolbar"><button className="icon-button" aria-label="返回文件列表" onClick={() => { void guard().then(ok => { if (ok) setScreen('files') }) }}><ArrowLeft size={19} /></button><div><strong>{doc.path.split('/').pop()}</strong><small>{dirty ? '有未保存修改' : doc.exists ? '已保存' : '新文件'}</small></div><details hidden={readOnly} className="file-actions"><summary aria-label="文件操作"><MoreHorizontal size={20} /></summary><div><button disabled={Boolean(busy)} onClick={event=>{event.currentTarget.closest("details")?.removeAttribute("open");void moveFile()}}>移动或重命名</button><button disabled={Boolean(busy)||!doc.exists} onClick={event=>{event.currentTarget.closest("details")?.removeAttribute("open");void deleteFile()}}>移除文件</button><button disabled={Boolean(busy)} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void reloadFile() }}><RefreshCw size={17} />重新读取</button><button disabled={Boolean(busy) || !doc.exists} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void restore() }}><RotateCcw size={17} />恢复上次保存</button></div></details><button className="primary-button" disabled={readOnly || !dirty || Boolean(busy)} onClick={() => { void save() }}>{busy === 'save' ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}保存</button></div><Suspense fallback={<div className="loading-row">正在准备编辑器</div>}><CodeEditor readOnly={readOnly} file={doc.path} value={content} onChange={setContent} dark={dark} /></Suspense></>
                  : <section className="task-list"><div className="test-actions"><button className="text-button" disabled={Boolean(busy)||Boolean(running)} onClick={()=>void checkProject()}>检查项目</button>{project.kind==='mod'&&!readOnly?<button className="text-button" disabled={Boolean(busy)||Boolean(running)} onClick={()=>void runProjectTests()}>运行项目测试</button>:null}</div>{checking?<div className="job-progress"><LoaderCircle size={17} className="spin"/><span>{checking.phase}</span><button className="text-button" onClick={()=>void rpc('job',{operation:'cancel',jobId:checking.id})}>取消</button></div>:null}{report?<VerificationReport report={report} onFile={file=>void openFile({name:file.split('/').pop()!,path:file,directory:false,size:0})}/>:null}<div className="section-toolbar"><span>{project.kind === 'mod' ? '构建任务' : '整合包导出'}</span>{project.kind === 'mod' ? <label className="check-field"><input type="checkbox" checked={offline} onChange={event => setOffline(event.target.checked)} />离线构建</label> : null}</div>{project.kind === 'mod' && !tasks.length ? <div className="empty"><Hammer size={30} /><p>保存项目后即可构建</p></div> : null}{tasks.map(task => <article className="task" key={task.id}><div className="task-title">{task.status === 'running' ? <LoaderCircle size={18} className="spin" /> : task.status === 'completed' ? <Check size={18} /> : <CircleAlert size={18} />}<strong>{phase(task)}</strong>{task.status === 'running' ? <button className="text-button" onClick={() => { void rpc('task', { operation: 'cancel', projectId: project.id, taskId: task.id }).then(() => setTasks(old => old.map(value => value.id === task.id ? { ...value, status: 'cancelled', phase: '已取消' } : value))).catch(reason => setError(MESSAGE(reason))) }}>取消</button> : <small>{task.endedAt ? Math.max(1, Math.round((Date.parse(task.endedAt) - Date.parse(task.startedAt)) / 1000)) + ' 秒' : ''}</small>}</div>{task.evidence?<p className="muted">游戏运行尚未验证</p>:null}{task.error ? <p className="task-error">{task.error}</p> : null}{task.artifacts.map(artifact => <ArtifactResult key={artifact.id} artifact={artifact}/>)}<details open={task.status === 'failed'}><summary>查看日志</summary><pre>{task.log || '正在准备构建环境…'}</pre></details></article>)}{artifacts.map(artifact => <ArtifactResult key={artifact.id} artifact={artifact}/>)}{project.kind === 'modpack' && !artifacts.length ? <div className="empty"><Package size={30} /><p>导入模组、编辑配置后导出整合包</p></div> : null}</section>}</div>
            {!readOnly && ['files','tasks'].includes(screen) ? <footer className="bottom-bar"><button className="primary-button" disabled={Boolean(busy) || Boolean(running)} onClick={() => { void (project.kind === 'mod' ? build() : exportPack()) }}>{busy || running ? <LoaderCircle size={17} className="spin" /> : project.kind === 'mod' ? <Hammer size={17} /> : <Package size={17} />}{project.kind === 'mod' ? running ? '构建中' : '构建模组' : '导出整合包'}</button></footer> : null}
    {confirmDialog.dialog}{promptDialog.dialog}
  </section>
}
