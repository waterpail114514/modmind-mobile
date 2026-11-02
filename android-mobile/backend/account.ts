import { promises as fs } from 'node:fs'
import path from 'node:path'
import { requestDeviceCode, pollDeviceCode, queryDeviceUsage, parseModelPayload, normalizeRelayBaseUrl, openAiV1BaseUrl, requestDeviceImageLease, queryDeviceImageProvider } from '../../src/main/deviceIntegration'
import { ProviderSyncService, type ProviderOwner } from '../../src/main/providerSync'
import { networkFetch } from '../../src/main/networkRequest'
import type { BeginnerAiPreferences } from '../../src/shared/types'
import serviceConfig from '../../resources/service-config.json'
import {sendDeviceFastMode} from '../../src/main/deviceIntegration'
import {normalizeQuotaModelPreferences} from '../../src/main/quotaModelPreferences'
import {selectedReasoningEfforts,reasoningSelectionEffort} from '../../src/shared/modelReasoning'
import {validateCodexAutoCompactTokenLimit,resolveCodexAutoCompactTokenLimit,prepareCodexModelCatalog} from '../../src/main/codexModelCatalog'
import {createHash} from 'node:crypto'

/** Credentials stay in the Android app's private, backup-disabled data directory. */
export class MobileAccount {
  private state: any = { preferences: { model: '', reasoningLevel: 'medium', fastMode: false } }
  private pending?: { code: string; authUrl: string; expiresAt: number }
  private writes = Promise.resolve()
  private scan: {status:'idle'|'running'|'complete'|'error';startedAt?:number;finishedAt?:number;message?:string;models?:number} = {status:'idle'}
  private scanTask?: Promise<void>
  private customCatalog?: {at:number;models:any[]}
  readonly providers: ProviderSyncService
  constructor(private root: string, readonly busy: () => boolean) {
    this.providers = new ProviderSyncService({
      read: async () => this.state.owner || null,
      write: async (_previous, sync) => { this.state.owner.sync = sync; await this.persist() },
      readSession: async () => this.state.session || null,
      writeSession: async session => { this.state.session = session; await this.persist() },
      readPreferences: async () => this.state.preferences,
      applyDefaults: async selection => {const previous=this.state.preferences;this.state.profiles||={};this.state.profiles[this.profileKey(previous)]=previous;const restored=this.state.profiles[this.profileKey(selection)]||{};this.state.preferences={...restored,...selection,fastMode:restored.fastMode||false};await this.persist();return this.state.preferences},
      listModels: async connection => this.listModels(connection.inferenceBaseUrl, connection.apiKey),
      paidBusy: () => this.busy(),
      readDiscovery: async () => this.state.discovery || null,
      writeDiscovery: async discovery => { this.state.discovery = discovery; await this.persist() }
    })
  }
  async initialize() { this.state = await fs.readFile(path.join(this.root, 'account.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return this.state }) }
  private persist() {
    const data = JSON.stringify(this.state)
    this.writes = this.writes.catch(() => {}).then(async () => { const file = path.join(this.root, 'account.json'); await fs.writeFile(file + '.pending', data, { mode: 0o600 }); await fs.rename(file + '.pending', file) })
    return this.writes
  }
  private selection(scope?:string){const binding=scope&&scope!=='settings'?(this.state.owner?.sync.bindings||this.state.bindings)?.[scope]:undefined;if(!binding)return this.state.preferences;const key=this.profileKey(binding),base=this.state.profiles?.[key]||(key===this.profileKey(this.state.preferences)?this.state.preferences:{fastMode:false});return {...base,...binding}}
  private assertMutable(){if(this.busy())throw Error('请先停止正在运行的 AI 任务');if(this.scanTask||this.providers.busy)throw Error('正在扫描或更新模型，请稍后重试')}
  status(scope?:string) { return { scan:this.scan,executionBusy:this.busy(),bound:Boolean(scope&&scope!=='settings'&&(this.state.owner?.sync.bindings||this.state.bindings)?.[scope]), connected: Boolean(this.state.owner || this.state.custom), username: this.state.owner?.username || (this.state.custom ? '自定义 API' : ''), custom: Boolean(this.state.custom), preferences: this.selection(scope), usage: this.state.usage || null, pending: this.pending && this.pending.expiresAt > Date.now() ? { authUrl: this.pending.authUrl, expiresAt: this.pending.expiresAt } : null } }
  async begin() {
    this.assertMutable()
    const result = await requestDeviceCode(serviceConfig.siteUrl, AbortSignal.timeout(30000))
    this.pending = { ...result, expiresAt: Date.now() + result.expiresIn * 1000 }
    return { authUrl: result.authUrl, expiresAt: this.pending.expiresAt }
  }
  async poll() {
    this.assertMutable()
    if (!this.pending || this.pending.expiresAt <= Date.now()) { this.pending = undefined; return { status: 'expired' } }
    const result = await pollDeviceCode(serviceConfig.siteUrl, this.pending.code, AbortSignal.timeout(30000))
    if (result.status !== 'ok') return result
    if ('provider' in result || !result.sync) throw Error('此授权未提供供应商连接，请使用支持连接同步的账号，或填写自己的 API')
    const connection = result.sync.connections.find(c => c.account === result.sync!.defaultAccount)!
    this.state = { owner: { siteUrl: serviceConfig.siteUrl, username: result.username, sync: result.sync, authorizationKey: result.apiKey } satisfies ProviderOwner,
      preferences: { model: connection.model || connection.models?.[0] || '', account: connection.account, billing: connection.kind === 'free' ? 'free' : 'quota', ...(connection.group ? { group: connection.group } : {}), reasoningLevel: 'medium', fastMode: false } }
    this.pending = undefined; await this.persist(); this.providers.invalidate()
    return { status: 'ok', ...this.status() }
  }
  async configure(input: any) {
    this.assertMutable()
    if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 4096 || /[\r\n\0]/.test(input.apiKey)) throw Error('API Key 无效')
    if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 256) throw Error('请输入模型名称')
    const baseUrl = openAiV1BaseUrl(input.baseUrl)
    this.state = { custom: { baseUrl, apiKey: input.apiKey.trim() }, preferences: { model: input.model.trim(), reasoningLevel: 'medium', fastMode: false } }
    this.customCatalog=undefined;this.scan={status:'idle'};await this.persist(); this.providers.invalidate(); return this.status()
  }
  async logout() { this.assertMutable(); this.state = { preferences: { model: '', reasoningLevel: 'medium', fastMode: false } }; this.pending = undefined; this.customCatalog=undefined;this.scan={status:'idle'};await this.persist(); this.providers.invalidate(); return this.status() }
  private async listModels(base: string, key: string) {
    const response = await networkFetch(openAiV1BaseUrl(base) + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw Error('模型列表读取失败（' + response.status + '）')
    return parseModelPayload(await response.json())
  }
  async catalog(refresh = false) {
    if (this.state.owner) return this.providers.catalog(refresh)
    if (!this.state.custom) return { models: [], connected: false, currentModel: '',stale:false,message:undefined }
    let stale=false
    try{if(refresh||!this.customCatalog||Date.now()-this.customCatalog.at>60000)this.customCatalog={at:Date.now(),models:(await this.listModels(this.state.custom.baseUrl,this.state.custom.apiKey)).slice(0,512)}}catch(e){if(!this.customCatalog)throw e;stale=true}
    return { models: this.customCatalog.models.map(m => ({ ...m, available: true, optionKey: m.id })),canSwitch:true, connected: true, currentModel: this.state.preferences.model, billing: 'custom',stale,...(stale?{message:'模型扫描失败，已保留上次列表，请重试'}:{}) }
  }
  /** Explicit discovery can visit provider groups. Keep it alive outside the HTTP request so restoration finishes after UI navigation. */
  discover(){
    if(this.scanTask)return this.scan
    this.assertMutable()
    if(!this.state.owner&&!this.state.custom)throw Error('请先连接账号或 API')
    this.scan={status:'running',startedAt:Date.now(),message:this.state.owner?'正在扫描可用模型，完成后恢复原线路':'正在读取服务商的模型列表'}
    this.scanTask=(async()=>{
      try{const value=this.state.owner?await this.providers.discoverModels():await this.catalog(true);if(value.stale)throw Error(value.message||'扫描未完成');this.scan={...this.scan,status:'complete',finishedAt:Date.now(),models:new Set(value.models.filter(m=>m.available!==false&&m.modelEvidence!=='unknown').map(m=>m.id)).size,message:'扫描完成'}}
      catch(e){this.scan={...this.scan,status:'error',finishedAt:Date.now(),message:e instanceof Error?e.message:'扫描未完成，请重试'}}
      finally{this.scanTask=undefined}
    })()
    return this.scan
  }
  async select(input: any) {
    this.assertMutable()
    if (this.state.owner) return this.providers.select(input.model, { account: input.account, group: input.group, billing: input.billing, scope: input.scope||'settings' })
    if (!(await this.catalog()).models.some((m: any) => m.id === input.model)) throw Error('所选模型不在当前服务列表中')
    if(input.scope&&input.scope!=='settings'){this.state.bindings||={};this.state.bindings[input.scope]={model:input.model,reasoningLevel:'auto'}}else{this.state.preferences.model=input.model;this.state.preferences.reasoningLevel='auto';this.state.bindings={}}await this.persist();return this.status(input.scope)
  }
  private profileKey(selection:any){return createHash('sha256').update(JSON.stringify([this.state.owner?.username||'',this.state.custom?.baseUrl||'',selection.account||'',selection.group||'',selection.billing||'custom'])).digest('hex')}
  async preferences(input:any){
    this.assertMutable()
    const previous=this.selection(input.scope)
    if(input.model!==previous.model)throw Error('模型已变化，请刷新设置后重试')
    const next=normalizeQuotaModelPreferences({...previous,...input},previous)
    reasoningSelectionEffort(next.reasoningLevel,undefined,selectedReasoningEfforts(next.model,next.reasoningEffortOptions))
    validateCodexAutoCompactTokenLimit(next.model,{contextWindow:next.modelContextWindows?.[next.model]},next.modelAutoCompactTokenLimits?.[next.model])
    if(next.fastMode!==previous.fastMode){
      if(!this.state.owner||previous.billing==='free')throw Error('当前线路由服务商管理速度，无法切换 Fast 模式')
      if(previous.account==='ls')throw Error('LS 暂不支持 Fast 模式')
      if(this.state.owner&&previous.billing!=='free'){const c=this.state.owner.sync.connections.find((c:any)=>c.account===previous.account);if(!c)throw Error('当前线路不存在');await sendDeviceFastMode(this.state.owner.siteUrl,c.apiKey,next.fastMode,AbortSignal.timeout(15000))}
    }
    this.state.profiles||={};this.state.profiles[this.profileKey(next)]=next
    if(input.scope&&input.scope!=='settings'){
      if(this.state.owner){this.state.owner.sync.bindings||={};this.state.owner.sync.bindings[input.scope]={model:next.model,reasoningLevel:next.reasoningLevel,...(next.account?{account:next.account,billing:next.billing}:{}),...(next.group?{group:next.group}:{})}}
      else{this.state.bindings||={};this.state.bindings[input.scope]=next}
    }else{this.state.preferences=next;if(this.state.owner?.sync.defaults)this.state.owner.sync.defaults={...this.state.owner.sync.defaults,reasoningLevel:next.reasoningLevel}}
    await this.persist();return this.status(input.scope)
  }
  async execution(home:string,allowLongerContext:boolean,scope?:string){
    const credentials=await this.resolve(scope),p=this.selection(scope),contextWindow=p.modelContextWindows?.[credentials.model],reasoning=p.reasoningLevel==='auto'?undefined:p.reasoningLevel
    const reasoningCapabilities={source:'provider' as const,controls:['effort' as const],efforts:selectedReasoningEfforts(credentials.model,p.reasoningEffortOptions)}
    const catalog=await prepareCodexModelCatalog(home,credentials.model,{baseUrl:credentials.baseUrl,contextWindow,reasoning:reasoningCapabilities,allowLongerContext})
    return {...credentials,reasoningEffort:reasoning,fastMode:p.fastMode,contextWindow,autoCompactTokenLimit:resolveCodexAutoCompactTokenLimit(credentials.model,{baseUrl:credentials.baseUrl,contextWindow,allowLongerContext},p.modelAutoCompactTokenLimits?.[credentials.model]),catalogPath:catalog.path}
  }
  async reset(scope:'workspace'|'inspiration'){this.assertMutable();if(this.state.owner)await this.providers.resetBinding(scope);else{if(this.state.bindings)delete this.state.bindings[scope];await this.persist()}return this.status(scope)}
  async resolve(scope?:string) {
    if(this.scanTask)throw Error('正在扫描模型，请完成后再发送')
    if (this.state.custom) return { ...this.state.custom, model: this.selection(scope).model }
    const result = await this.providers.resolve(this.selection(scope))
    return { baseUrl: result.connection.inferenceBaseUrl, apiKey: result.connection.apiKey, model: result.model }
  }
  async usage() {
    if (!this.state.owner) return { tracked: false, message: this.state.custom ? '自定义 API 的余额请在服务商处查看' : '请先登录账号' }
    const owner: ProviderOwner = this.state.owner
    const usage = await queryDeviceUsage(owner.siteUrl, owner.authorizationKey || owner.sync.connections.find(c => c.account === owner.sync.defaultAccount)!.apiKey, AbortSignal.timeout(30000))
    this.state.usage = usage; await this.persist(); return { tracked: true, ...usage }
  }
  private async imageCredentials() {
    if(this.scanTask)throw Error('正在扫描模型，请完成后再生成图片')
    const owner: ProviderOwner | undefined = this.state.owner
    if (!owner) throw Error('请先登录 ModMind 账号再生成图片')
    return { siteUrl: owner.siteUrl, username: owner.username, apiKey: owner.authorizationKey || owner.sync.connections[0].apiKey, routingToken: await this.providers.routingToken() }
  }
  async imageProvider() { const credentials = await this.imageCredentials(); return queryDeviceImageProvider(credentials.siteUrl, credentials.routingToken || credentials.apiKey, AbortSignal.timeout(30000)) }
  async imageLease(signal: AbortSignal) { return requestDeviceImageLease(await this.imageCredentials(), signal) }
}
