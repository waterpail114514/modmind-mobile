import {AnimatePresence} from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Box, Check, ChevronRight, Layers3, LoaderCircle, Menu, Moon, Plus, Search, Sun, Settings, X, Upload, MoreHorizontal } from 'lucide-react'
import { environment, native, rpc } from './bridge'
import Sheet from './Sheet'
import modmindLogo from '../../src/renderer/src/assets/logo.png'
import {useConfirmDialog} from '../../src/renderer/src/components/InteractionDialogs'
import {waitJob,size} from './jobs'
const ProjectManager=lazy(()=>import('./ProjectManager'))
import type { Environment, Project, Studio } from './types'
const StudioPanel=lazy(()=>import('./StudioPanel'))
const ProjectTools=lazy(()=>import('./ProjectTools'))
const SettingsPanel=lazy(()=>import('./SettingsPanel'))
import {themeCssVariables} from '../../src/shared/appTheme'
import {defaultMobilePreferences,type MobilePreferences} from '../shared/settings'
const ModelInspector=lazy(()=>import('./ModelInspector'))
const Knowledge=lazy(()=>import('./Knowledge'))
type Surface='workspace'|'inspiration'
type Overlay={kind:'files'|'tasks'|'notes'|'model';path?:string}
const message=(e:unknown)=>e instanceof Error?e.message:String(e)
export default function App(){
  const settingsConfirm=useConfirmDialog()
  const closeSettings=()=>{void(async()=>{if(document.querySelector('[data-settings-dirty="true"]')&&!await settingsConfirm.confirm({title:'放弃尚未保存的设置？',message:'已保存的修改会保留。',confirmLabel:'放弃修改'}))return;setAccount(false);setAccountRevision(old=>old+1)})()}
  const [env,setEnv]=useState<Environment|null>(null),[connecting,setConnecting]=useState(false),[projects,setProjects]=useState<Project[]>([]),[project,setProject]=useState<Project|null>(null),[ready,setReady]=useState(false),[error,setError]=useState('')
  const [surface,setSurface]=useState<Surface>(()=>localStorage.getItem('modmind.mobile.surface')==='inspiration'?'inspiration':'workspace'),[drawer,setDrawer]=useState(false),[account,setAccount]=useState(false),[accountRevision,setAccountRevision]=useState(0),[creating,setCreating]=useState(false),[overlay,setOverlay]=useState<Overlay|null>(null)
  const [kind,setKind]=useState<Studio>('mod'),[name,setName]=useState(''),[namespace,setNamespace]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[dark,setDark]=useState(document.documentElement.dataset.themeMode==='dark')
  const [managing,setManaging]=useState<Project|null>(null),[transfer,setTransfer]=useState<any>(),[transferJob,setTransferJob]=useState<any>()
  const [preferences,setPreferences]=useState<MobilePreferences>(defaultMobilePreferences),[settingsStart,setSettingsStart]=useState('root')
  const applyPreferences=(value:MobilePreferences)=>{setPreferences(value);const night=value.theme==='system'?matchMedia('(prefers-color-scheme: dark)').matches:value.theme==='dark';setDark(night);for(const [key,color]of Object.entries(themeCssVariables(value.themePreset,night?'dark':'light',value.customThemeColors)))document.documentElement.style.setProperty(key,color);void native('appearance',{fontScale:value.fontScale}).catch(()=>{})}
  const started=useRef(false)
  const openProject=(selected:Project)=>{setProject(selected);setKind(selected.kind);setDrawer(false);setError('');setOverlay(null);localStorage.setItem('modmind.mobile.project',selected.id)}
  const connect=async()=>{
    if(connecting)return;setConnecting(true);setError('')
    try{
      let status=await native<Environment>('connect');setEnv(status)
      for(let attempt=0;!status.connected&&attempt<90;attempt++){await new Promise(resolve=>setTimeout(resolve,1000));status=await environment();setEnv(status);if(!status.connected&&status.message&&status.message!=='本地环境尚未启动')throw Error(status.message)}
      if(!status.connected)throw Error('环境启动较慢，请重试')
      const result=await rpc<{projects:Project[]}>('query',{operation:'projects'});setProjects(result.projects)
      const last=result.projects.find(p=>p.id===localStorage.getItem('modmind.mobile.project'))||result.projects[0];if(last)openProject(last)
      applyPreferences(await rpc<MobilePreferences>('settings',{operation:'read'}));setReady(true)
    }catch(e){setError(message(e))}finally{setConnecting(false)}
  }
  useEffect(()=>{if(!started.current){started.current=true;void connect()}},[])
  useEffect(()=>{document.documentElement.dataset.themeMode=dark?'dark':'light';localStorage.setItem('modmind.mobile.theme',dark?'dark':'light');void native('theme',{dark,canvas:getComputedStyle(document.documentElement).getPropertyValue('--theme-panel').trim()}).catch(()=>{})},[dark])
  useEffect(()=>{localStorage.setItem('modmind.mobile.surface',surface)},[surface])
  useEffect(()=>{
    window.__modmindBack=()=>{
      if(document.querySelector('.modal-backdrop')){window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true}
      const dialogs=Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')),modal=dialogs.filter(d=>d.dataset.exiting!=='true').at(-1)
      if(modal){modal.dispatchEvent(new Event('cancel',{cancelable:true}));return true}
      return dialogs.length>0
    }
    return()=>{delete window.__modmindBack}
  },[])
  const closeOverlay=()=>{void(async()=>{if(overlay?.kind==='files'||overlay?.kind==='tasks'){if(window.__modmindToolGuard&&!await window.__modmindToolGuard())return}setOverlay(null)})()}
  const create=async(e:React.FormEvent)=>{
    e.preventDefault();setBusy(true);setError('')
    try{const result=await rpc<Project>('create',{name,namespace,kind});setProjects(old=>[result,...old]);openProject(result);setCreating(false)}catch(e){setError(message(e))}finally{setBusy(false)}
  }
  const refreshProjects=async()=>{const result=await rpc<{projects:Project[]}>('query',{operation:'projects'});setProjects(result.projects);return result.projects}
  const importProject=async()=>{setBusy(true);setError('');try{const result=await native<any>('pickProject');if(result?.id){setTransfer(result);setDrawer(false)}}catch(e){setError(message(e));setDrawer(true)}finally{setBusy(false)}}
  const confirmImport=async()=>{setBusy(true);setError('');try{const job=await rpc<any>('project',{operation:'import_start',ticket:transfer.id,name:transfer.name});setTransferJob(job);const result=await waitJob(job.id,setTransferJob);await refreshProjects();openProject(result.project);setTransfer(undefined)}catch(e){setError(message(e))}finally{setBusy(false);setTransferJob(undefined)}}
  const newProject=()=>{setName('');setNamespace('');setError('');setDrawer(false);setCreating(true)}
  return <div className="mobile-app">
    {project&&ready?<Suspense fallback={<div className="loading-row"><LoaderCircle size={20} className="spin"/></div>}><StudioPanel key={project.id+surface} project={project} surface={surface} onSurface={value=>{setOverlay(null);setSurface(value)}} onProjects={()=>setDrawer(true)} onAccount={()=>{setSettingsStart('account');setAccount(true)}} preferences={preferences} accountRevision={accountRevision} onAction={kind=>setOverlay({kind})} onFile={path=>setOverlay(/\.bbmodel$/i.test(path)?{kind:'model',path}:{kind:'files',path})} onModel={path=>setOverlay({kind:'model',path})}/></Suspense>:<><header className="chat-header"><button className="icon-button" aria-label="切换项目" onClick={()=>setDrawer(true)}><Menu size={21}/></button><span className="app-name">ModMind</span></header>{!ready?<div className="startup"><LoaderCircle size={22} className={connecting?'spin':''}/><p>{connecting?'正在准备工作台':error||env?.message||'本地环境尚未连接'}</p>{!connecting?<button className="secondary-button" onClick={()=>void connect()}>重新连接</button>:null}</div>:<div className="first-project"><img className="empty-logo" src={modmindLogo} alt="ModMind" width={56} height={56}/><h1>从一个想法开始</h1><button className="primary-button" onClick={newProject}><Plus size={18}/>新建项目</button><button className="text-button" disabled={busy} onClick={()=>void importProject()}>导入已有项目</button></div>}</>}
    <AnimatePresence>
    {drawer?<Sheet key="projects" title="项目" close={()=>setDrawer(false)} className="projects-sheet"><div className="project-drawer"><div className="drawer-tools"><label className="drawer-search"><Search size={17}/><input aria-label="搜索项目" placeholder="搜索项目" value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="icon-button" disabled={!ready||busy} aria-label="导入完整项目" onClick={()=>void importProject()}><Upload size={20}/></button><button className="icon-button" disabled={!ready} aria-label="新建项目" onClick={newProject}><Plus size={22}/></button></div><div className="kind-filter"><button aria-pressed={kind==='mod'} onClick={()=>setKind('mod')}>模组</button><button aria-pressed={kind==='modpack'} onClick={()=>setKind('modpack')}>整合包</button></div><div className="project-list">{error?<p className="inline-error" role="alert">{error}</p>:null}{projects.filter(p=>p.kind===kind&&p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(p=><div className="project-list-row" key={p.id}><button className="project-row" aria-pressed={project?.id===p.id} key={p.id} onClick={()=>openProject(p)}>{p.kind==='mod'?<Box size={19}/>:<Layers3 size={19}/>}<span>{p.name}</span>{project?.id===p.id?<Check size={16}/>:<ChevronRight size={16}/>}</button><button className="icon-button" aria-label={"管理项目 "+p.name} onClick={()=>{setDrawer(false);setManaging(p)}}><MoreHorizontal size={19}/></button></div>)}{!projects.some(p=>p.kind===kind&&p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))?<p className="empty-small">{search?'没有匹配项目':'还没有'+(kind==='mod'?'模组':'整合包')+'项目'}</p>:null}</div><footer className="drawer-footer"><button className="account-entry" onClick={()=>{setDrawer(false);setSettingsStart('root');setAccount(true)}}><Settings size={20}/><span>设置</span><ChevronRight size={16}/></button><button className="icon-button" aria-label={dark?'切换浅色主题':'切换深色主题'} onClick={()=>void rpc<any>('settings',{operation:'read'}).then(s=>rpc<MobilePreferences>('settings',{operation:'save',patch:{theme:dark?'light':'dark'},revision:s.revision})).then(applyPreferences).catch(e=>setError(message(e)))}>{dark?<Sun size={19}/>:<Moon size={19}/>}</button></footer></div></Sheet>:null}
    {managing?<Sheet key="manage" title="项目管理" close={()=>setManaging(null)} className="context-sheet"><Suspense fallback={<div className="loading-row">正在读取</div>}><ProjectManager project={managing} onChanged={updated=>{setProjects(old=>old.map(p=>p.id===updated.id?updated:p));setManaging(updated);if(project?.id===updated.id)setProject(updated)}} onRemoved={()=>{setManaging(null);void refreshProjects().then(list=>{if(project?.id===managing.id){if(list[0])openProject(list[0]);else{setProject(null);localStorage.removeItem('modmind.mobile.project')}}})}}/></Suspense></Sheet>:null}
    {transfer?<Sheet key="transfer" title="导入项目" close={()=>{if(!busy){void rpc('project',{operation:'import_discard',ticket:transfer.id}).catch(()=>{});setTransfer(undefined)}}}><div className="panel-scroll"><label className="field">项目名称<input aria-label="导入项目名称" value={transfer.name} disabled={busy} onChange={e=>setTransfer({...transfer,name:e.target.value})}/></label><p>{transfer.kind==='mod'?'模组':'整合包'} · {transfer.minecraftVersion}</p><p className="muted">{transfer.files} 个文件 · 展开约 {size(transfer.bytes)}，跳过 {transfer.skipped} 项缓存或生成文件</p>{transfer.warnings.map((warning:string,i:number)=><p className="inline-error" key={i}>{warning}</p>)}{error?<p className="inline-error" role="alert">{error}</p>:null}{transferJob?<div className="job-progress" role="status"><LoaderCircle size={17} className="spin"/><span>{transferJob.phase}</span><button className="text-button" onClick={()=>void rpc('job',{operation:'cancel',jobId:transferJob.id})}>取消</button></div>:null}<button className="primary-button" disabled={busy||!transfer.name.trim()} onClick={()=>void confirmImport()}>{busy?'正在导入':'导入并打开'}</button></div></Sheet>:null}
    {creating?<Sheet key="create" title="新建项目" close={()=>{if(!busy)setCreating(false)}} className="create-sheet"><form className="panel-scroll create-project" onSubmit={e=>void create(e)}><div className="kind-filter"><button type="button" aria-pressed={kind==='mod'} onClick={()=>setKind('mod')}><Box size={17}/>模组制作</button><button type="button" aria-pressed={kind==='modpack'} onClick={()=>setKind('modpack')}><Layers3 size={17}/>整合包制作</button></div><label className="field">项目名称<input autoFocus aria-label="项目名称" value={name} required maxLength={100} onChange={e=>setName(e.target.value)}/></label><label className="field">项目标识<input aria-label="项目标识" value={namespace} autoCapitalize="none" autoCorrect="off" pattern="[a-z][a-z0-9_]{1,47}" maxLength={48} placeholder="例如 my_first_mod" required onChange={e=>setNamespace(e.target.value)}/></label><span className="target-version">Fabric 1.21.1</span>{error?<p className="inline-error" role="alert">{error}</p>:null}<button className="primary-button create-submit" disabled={busy}>{busy?<LoaderCircle size={17} className="spin"/>:<Plus size={17}/>}创建项目</button></form></Sheet>:null}
    {account?<Sheet key="settings" title="设置" back={()=>Boolean(window.__modmindSettingsBack?.())} close={closeSettings} className="settings-sheet"><Suspense fallback={<div className="loading-row">正在读取账号</div>}><SettingsPanel close={closeSettings} surface={surface} initial={settingsStart} onSaved={applyPreferences}/>{settingsConfirm.dialog}</Suspense></Sheet>:null}
    {overlay&&project?<Sheet key="context" title={overlay.kind==='files'?'项目文件':overlay.kind==='tasks'?(project.kind==='mod'?'构建记录':'导出整合包'):overlay.kind==='model'?overlay.path!.split('/').pop()!:'项目知识'} close={closeOverlay} back={()=>Boolean((overlay.kind==='files'||overlay.kind==='tasks')&&window.__modmindToolBack?.())} className="context-sheet"><Suspense fallback={<div className="loading-row">正在打开</div>}>{overlay.kind==='model'?<ModelInspector projectId={project.id} path={overlay.path!} readOnly={surface==='inspiration'} onSource={()=>setOverlay({kind:'files',path:overlay.path})}/>:overlay.kind==='notes'?<Knowledge projectId={project.id}/>:<ProjectTools key={project.id+overlay.kind+(overlay.path||'')} project={project} initialScreen={overlay.kind} initialPath={overlay.path} readOnly={surface==='inspiration'} onOpenModel={path=>setOverlay({kind:'model',path})}/>}</Suspense></Sheet>:null}
  </AnimatePresence></div>
}
