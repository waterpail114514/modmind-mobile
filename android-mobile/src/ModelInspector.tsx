import { lazy, Suspense, useEffect, useState } from 'react'
import { rpc } from './bridge'
const ModelCanvas = lazy(() => import('./ModelCanvas'))
export default function ModelInspector({ projectId, path, readOnly, onSource }: { projectId: string; path: string; readOnly: boolean; onSource():void }) {
  const [doc, setDoc] = useState<any>(), [preview, setPreview] = useState<any>(), [dimensions, setDimensions] = useState([16, 16, 16]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const load = async () => {
    const document = await rpc<any>('models', { operation: 'read', projectId, path }), value = await rpc('models', { operation: 'preview', projectId, path })
    setDoc(document); setPreview(value)
    const cube = JSON.parse(document.content).elements?.[0]
    setDimensions(cube?.to?.map((v: number, i: number) => v - (cube.from?.[i] || 0)) || [16, 16, 16])
  }
  useEffect(() => { let active = true; void load().catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [projectId, path])
  return <div className="panel-scroll model-inspector">{error ? <p className="inline-error" role="alert">{error}</p> : null}{preview ? <><Suspense fallback={<div className="model-canvas" />}><ModelCanvas preview={preview} /></Suspense>{preview.warnings.map((warning: string, i: number) => <p className="muted" key={i}>{warning}</p>)}{!readOnly ? <><div className="dimension-fields">{['宽', '高', '深'].map((label, i) => <label key={label}>{label}<input aria-label={'模型' + label} type="number" step="0.5" min="0.01" max="1024" value={dimensions[i]} onChange={e => setDimensions(old => old.map((v, j) => j === i ? Number(e.target.value) : v))} /></label>)}</div><button className="primary-button" disabled={busy} onClick={() => { setBusy(true); setError(''); void (async () => {
      if (dimensions.some(v => !Number.isFinite(v) || v <= 0 || v > 1024)) throw Error('尺寸需大于 0 且不超过 1024')
      const data = JSON.parse(doc.content), cube = data.elements[0]
      if (cube.type === 'mesh' || !Array.isArray(cube.from)) throw Error('此模型请通过对话修改')
      cube.to = cube.from.map((v: number, i: number) => v + dimensions[i])
      await rpc('write', { operation: 'save', projectId, path, revision: doc.revision, content: JSON.stringify(data, null, 2) }); await load(); setNotice('已保存')
    })().catch(e => setError(e.message)).finally(() => setBusy(false)) }}>保存尺寸</button>{notice ? <span className="inline-notice" role="status">{notice}</span> : null}</> : null}<button className="text-button" onClick={onSource}>{readOnly?'查看源码':'编辑源码'}</button><p className="asset-path">{path}</p></> : !error ? <div className="loading-row">正在打开模型</div> : <button className="text-button" onClick={() => { setError(''); void load().catch(e => setError(e.message)) }}>重试</button>}</div>
}
