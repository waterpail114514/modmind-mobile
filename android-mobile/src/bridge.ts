import type { Environment } from './types'
declare global {
  interface Window {
    ModMindNative?: { invoke(id: string, method: string, input: string): void }
    __modmindReply?: (id: string, packet: { ok: boolean; value?: unknown; error?: { message: string } }) => void
    __modmindBack?: () => boolean
    __modmindToolBack?: () => boolean
    __modmindToolGuard?: () => Promise<boolean>
    __modmindSettingsBack?: () => boolean
  }
}
const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
window.__modmindReply = (id, packet) => {
  const request = pending.get(id); if (!request) return
  clearTimeout(request.timer); pending.delete(id)
  if (packet.ok) request.resolve(packet.value)
  else request.reject(new Error(packet.error?.message || '本地操作未完成'))
}
export function native<T = any>(method: string, input: unknown = {}): Promise<T> {
  if (!window.ModMindNative) return Promise.reject(new Error('请在 ModMind 安卓应用中打开此页面'))
  if (pending.size >= 32) return Promise.reject(new Error('本地请求较多，请稍后重试'))
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(new Error('本地操作等待超时，请检查环境后重试')) }, method.startsWith('pick') ? 300000 : 130000)
    pending.set(id, { resolve, reject, timer })
    try { window.ModMindNative!.invoke(id, method, JSON.stringify(input)) }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error) }
  })
}
export const rpc = <T = any>(action: string, input: unknown) => native<T>('rpc', { action, input })
export const environment = () => native<Environment>('environment')
