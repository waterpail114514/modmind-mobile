import {useState} from 'react'
import {LoaderCircle,Search,ScanLine} from 'lucide-react'
import type {AiModelInfo} from '../../src/shared/types'
import {quotaModelDisplayMetadata} from '../../src/shared/quotaModels'
import ModelCatalogRows,{filterModelCatalog,modelCatalogFamilies,modelCatalogKey} from '../../src/renderer/src/components/ModelCatalogRows'
import gpt from '../../src/renderer/src/assets/model-characters/gpt.webp'
import gemini from '../../src/renderer/src/assets/model-characters/gemini.webp'
import grok from '../../src/renderer/src/assets/model-characters/grok.webp'
import glm from '../../src/renderer/src/assets/model-characters/glm.webp'
import kimi from '../../src/renderer/src/assets/model-characters/kimi.webp'
import deepseek from '../../src/renderer/src/assets/model-characters/deepseek.webp'
import qwen from '../../src/renderer/src/assets/model-characters/qwen.webp'
import modmind from '../../src/renderer/src/assets/model-characters/modmind.webp'
const characters:Record<string,string>={GPT:gpt,Gemini:gemini,Grok:grok,GLM:glm,Kimi:kimi,DeepSeek:deepseek,Qwen:qwen}
export default function MobileModelPicker({catalog,preferences,scope,loading,scanning,disabled,switching,error,onSelect,onScan}:{catalog:any;preferences:any;scope:'settings'|'workspace'|'inspiration';loading:boolean;scanning:boolean;disabled:boolean;switching?:string;error?:{model:string;account?:string;message:string};onSelect(model:AiModelInfo):void;onScan():void}){
  const [family,setFamily]=useState('推荐'),[query,setQuery]=useState('')
  const models:AiModelInfo[]=(catalog?.models||[]).filter((m:AiModelInfo)=>m.modelEvidence!=='unknown')
  const current=models.find(m=>m.id===preferences.model&&(!preferences.account||m.account===preferences.account)&&(!preferences.group||m.group===preferences.group)&&(!preferences.billing||m.billing===preferences.billing))
  const currentKey=current?modelCatalogKey(current):undefined,metadata=quotaModelDisplayMetadata(current||{id:preferences.model||''})
  const families=modelCatalogFamilies(models),active=families.includes(family)?family:'推荐'
  return <div className="mobile-model-picker quota-model-picker">
    <div className="mobile-model-current"><div><span className="settings-eyebrow">当前模型</span><strong>{metadata.name||'选择模型'}</strong><span>{[current?.providerLabel,current?.groupLabel,current?.billing==='free'?'免费':undefined].filter(Boolean).join(' · ')||'自定义 API'}</span></div><img src={characters[metadata.family]||modmind} alt="" width="88" height="100" decoding="async"/></div>
    <div className="mobile-model-search"><label className="drawer-search"><Search size={17}/><input type="search" aria-label="搜索模型" placeholder="搜索模型或线路" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="scan-models" disabled={disabled||loading||scanning} aria-label="扫描可用模型" onClick={onScan}>{scanning?<LoaderCircle size={17} className="spin"/>:<ScanLine size={17}/>}<span>{scanning?'扫描中':'扫描'}</span></button></div>
    <div className="mobile-model-families" role="group" aria-label="模型家族">{families.map(value=><button key={value} aria-pressed={!query&&active===value} onClick={()=>{setFamily(value);setQuery('')}}>{value}</button>)}</div>
    <div className="mobile-model-list" aria-busy={loading||scanning}>
      {catalog?.message?<p className="muted" role="status">{catalog.message}</p>:null}
      {models.length?<ModelCatalogRows models={filterModelCatalog(models,active,query,currentKey)} catalogModels={models} routeChoiceScope={scope} currentKey={currentKey} currentModelId={preferences.model} switchingKey={switching} query={query} disabled={disabled||scanning||catalog?.canSwitch===false} selectionRequired={catalog?.selectionRequired||catalog?.recoveryRequired} selectionError={error} onSelect={onSelect}/>:<div className="mobile-model-empty" role="status">{loading?'正在读取模型…':'还没有可用模型，点扫描重试'}</div>}
    </div>
  </div>
}
