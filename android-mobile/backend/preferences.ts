import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {defaultMobilePreferences,type MobilePreferences} from '../shared/settings'
import {normalizeCustomThemeColors,normalizeThemePreset} from '../../src/shared/appTheme'
import {setNetworkProxy} from '../../src/main/networkRequest'
export class MobileSettings{
  private value:MobilePreferences={...defaultMobilePreferences};private tail=Promise.resolve()
  constructor(private root:string,private busy:()=>boolean){}
  async initialize(){this.value={...defaultMobilePreferences,...await fs.readFile(path.join(this.root,'preferences.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return{};throw e})};setNetworkProxy(this.value.networkProxyUrl)}
  read(){return {...this.value,revision:createHash('sha256').update(JSON.stringify(this.value)).digest('hex')}}
  async save(patch:Record<string,unknown>,revision:string){
    const work=this.tail.then(async()=>{
      if(revision!==this.read().revision)throw Error('设置已更新，请重新读取后保存')
      if(this.busy())throw Error('请先结束当前 AI 或构建任务，再修改设置')
      for(const key of Object.keys(patch))if(!Object.hasOwn(defaultMobilePreferences,key))throw Error('未知设置项：'+key)
      const next={...this.value,...patch} as MobilePreferences
      if(!['system','light','dark'].includes(next.theme)||!['managed','manual'].includes(next.approvalMode)||!['auto','china','official'].includes(next.gradleDownloadSource))throw Error('设置选项无效')
      for(const key of ['reasoningExpanded','notificationsEnabled','allowLongerContext','offlineBuild'] as const)if(typeof next[key]!=='boolean')throw Error('开关设置无效')
      if(!Number.isInteger(next.fontScale)||next.fontScale<80||next.fontScale>125||!Number.isInteger(next.buildMemoryMb)||next.buildMemoryMb<512||next.buildMemoryMb>4096)throw Error('字体或构建内存超出范围')
      for(const key of ['workspacePrompt','inspirationPrompt'] as const)if(typeof next[key]!=='string'||Buffer.byteLength(next[key])>32768)throw Error('补充提示词不得超过 32 KiB')
      if(typeof next.networkProxyUrl!=='string'||next.networkProxyUrl.length>2048)throw Error('代理地址无效')
      if(next.networkProxyUrl){const url=new URL(next.networkProxyUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('使用不含账号密码的 HTTP 或 HTTPS 代理地址')}
      next.themePreset=normalizeThemePreset(next.themePreset);next.customThemeColors=normalizeCustomThemeColors(next.customThemeColors)
      const target=path.join(this.root,'preferences.json'),temp=target+'.'+randomUUID()+'.tmp'
      try{await fs.writeFile(temp,JSON.stringify(next),{mode:0o600});await fs.rename(temp,target);const actual=JSON.parse(await fs.readFile(target,'utf8'));if(JSON.stringify(actual)!==JSON.stringify(next))throw Error('设置回读不一致')}finally{await fs.rm(temp,{force:true})}
      this.value=next;setNetworkProxy(next.networkProxyUrl);return this.read()
    });this.tail=work.then(()=>{},()=>{});return work
  }
}
