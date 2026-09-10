import { createPortal } from 'react-dom'
import { useInputMenu, commands } from './input-menu.js'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Transcript, useConversation } from './transcript.js'
import { transcriptStyles } from './transcript-styles.js'
import { Tooltip } from './native-Tooltip.js'
import { Toast } from './native-Toast.js'
import { nativeStyles } from './native-styles.js'
import { IconChevronDownOutline14, IconChevronRightOutline14, IconCheckOutline16, IconDataOutline16 } from './native-icons.js'
import { useEffect, useState, useRef, useLayoutEffect, useId, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { Worker, Action, Conversation, ModelSettings, Effort, Skill } from './types.js'
export { WORKFLOW_PLUGIN_ID } from './constants.js'
declare module '@deepseek-ai/cordis' { interface Context { connection: ConnectionHandle } }
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap { 'codex-worker': { workerId: string } }
}
export const name = 'dsh-workflow-kit'
export const inject = ['connection', 'slots', 'sidebarRight', 'sidebarRightTabs']
export type Call = (sessionId: string, input: Action) => Promise<unknown>
const labels: Record<string, string> = { starting: '启动中', running: '运行中', 'interrupt-requested': '中断中', idle: '空闲', saved: '已保存', unknown: '状态未知' }
export function workerLabel(w: Worker): string {
  const model = (w.model ?? '模型未知').replace(/^gpt-/, '').replace(/^\d+(?:\.\d+)*-(?!mini(?:-|$)|nano(?:-|$)|codex(?:-|$)|pro(?:-|$))([a-z]+)$/, '$1')
  return w.role || `${model} · ${w.effort ?? '默认'}`
}
export function toggleWorker(sidebar: { isExpanded(): boolean; toggleExpanded(): void; openTab(kind: string, options: any): void }, current: { sessionId: string; workerId: string } | undefined, sessionId: string, w: Worker): void {
  if (sidebar.isExpanded() && current?.sessionId === sessionId && current.workerId === w.id) sidebar.toggleExpanded()
  else sidebar.openTab('codex-worker', { params: { workerId: w.id } })
}
export function active(w: Worker): boolean {
  return ['starting', 'running', 'interrupt-requested', 'unknown'].includes(w.state) || (w.approvals ?? []).length > 0 || w.reports.some(r => !r.acknowledgedAt && r.acceptance === 'pending')
}
export function occupancy(w: Worker): number | null {
  const used = w.usage?.last.totalTokens, capacity = w.usage?.modelContextWindow
  return typeof used === 'number' && used >= 0 && typeof capacity === 'number' && capacity > 0 ? Math.min(100, used / capacity * 100) : null
}
function useWorkers(sessionId: string, call: Call) {
  const [workers, setWorkers] = useState<Worker[]>([]), [error, setError] = useState('')
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>
    setWorkers([]); setError('')
    const update = async () => {
      try { const rows = await call(sessionId, { action: 'list' }) as Worker[]; if (!disposed) { setWorkers(rows); setError('') } }
      catch (e) { if (!disposed) setError(String(e)) }
      finally { if (!disposed) timer = setTimeout(update, 1500) }
    }
    void update(); return () => { disposed = true; clearTimeout(timer) }
  }, [sessionId, call])
  return { workers, error }
}
export function formatContext(value: number | null | undefined): string { return typeof value === 'number' ? `${Math.round(value / 100) / 10}k` : '—' }
function Meter({ worker }: { worker: Worker }) {
  const panel = useRef<HTMLDivElement>(null), [open, setOpen] = useState(false)
  useEffect(() => { const node = panel.current; const update = () => setOpen(node?.matches(':popover-open') ?? false); node?.addEventListener('toggle', update); return () => node?.removeEventListener('toggle', update) }, [worker.usage])
  const value = occupancy(worker)
  if (value === null) return null
  const usage = `${formatContext(worker.usage?.last.totalTokens)} / ${formatContext(worker.usage?.modelContextWindow)}`
  return <span className="cw-context-root">
    <Tooltip label={`上下文占用 ${Math.round(value)}%`} side="top" delayMs={200} disabled={open}>
      <button type="button" className="cw-context-ring" aria-label={`上下文占用 ${Math.round(value)}%`} aria-haspopup="dialog" aria-expanded={open} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); if (panel.current) { panel.current.style.left = `${Math.max(12, Math.min(rect.right - 264, window.innerWidth - 276))}px`; panel.current.style.bottom = `${window.innerHeight - rect.top + 8}px`; panel.current.togglePopover() } setOpen(panel.current?.matches(':popover-open') ?? false) }}>
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" fill="none" strokeWidth="2"><circle cx="7" cy="7" r="5" stroke="var(--dsw-alias-border-l3)" /><circle cx="7" cy="7" r="5" stroke="var(--dsw-alias-label-tertiary)" pathLength="100" strokeDasharray={`${value} 100`} strokeLinecap="round" transform="rotate(-90 7 7)" /></svg>
      </button>
    </Tooltip>
    <div ref={panel} {...{ popover: 'auto' }} className="cw-context-panel" role="dialog" aria-label="上下文用量"><span>上下文占用 <strong>{Math.round(value)}%</strong></span><strong>{usage}</strong><div className="cw-context-bar"><span style={{ width: `${value}%` }} /></div></div>
  </span>
}
function UserActions({worker,call,sessionId,closed}: {worker:Worker;call:Call;sessionId:string;closed?:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const act=async(action:'link'|'detach')=>{setBusy(true);setError('');try{await call(sessionId,{action,workerId:worker.id});if(action==='detach')closed?.()}catch(e){setError(String(e))}finally{setBusy(false)}}
  return <span className="cw-user-actions"><Tooltip label="交给当前 agent" side="bottom"><button type="button" aria-label={`Link ${worker.name}`} disabled={busy} onClick={()=>void act('link')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/></svg></button></Tooltip><Tooltip label="移出用户对话组，保留历史" side="bottom"><button type="button" aria-label={`Close ${worker.name}`} disabled={busy} onClick={()=>void act('detach')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></Tooltip>{error&&<span role="alert">{error}</span>}</span>
}
function DockGroup({label,children}: {label:string;children:import('react').ReactNode}) {
 const [open,setOpen]=useState(false)
 return <div className="cw-fold" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)} onFocus={()=>setOpen(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false)}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false)}}><button className="cw-fold-trigger" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{label}</button>{open&&<div className="cw-fold-list" aria-label={label.startsWith('非活跃')?'非活跃对话':label}>{children}</div>}</div>
}
export function Dock({sessionId,call,open,newChat,resumeChat,collapsed=false,closed}: {sessionId:string;call:Call;open:(w:Worker)=>void;newChat?:()=>void;resumeChat?:()=>void;collapsed?:boolean;closed?:(w:Worker)=>void}) {
 const {workers,error}=useWorkers(sessionId,call)
 const agents=workers.filter(w=>w.owner!=='user'),users=workers.filter(w=>w.owner==='user'),visible=agents.filter(active),folded=agents.filter(w=>!active(w))
 const pill=(w:Worker)=>{
  const percent=occupancy(w)??0,usage=`${formatContext(w.usage?.last.totalTokens)} / ${formatContext(w.usage?.modelContextWindow)}`
  const button=<button className="cw-pill" onClick={()=>open(w)} aria-label={`打开 Codex 对话 ${w.name}`} title={`${w.name} · ${labels[w.state]}`} style={{backgroundImage:`linear-gradient(to right, color-mix(in srgb, #729ce1 24%, transparent) ${percent}%, transparent ${percent}%)`}}><span className="cw-type">{workerLabel(w)}</span><span className="cw-usage">{usage}</span></button>
  return <span className={`cw-pill-row${w.owner==='user'?' cw-user-pill':''}`} key={w.id}>{button}{w.owner==='user'&&<UserActions worker={w} call={call} sessionId={sessionId} closed={()=>closed?.(w)} />}</span>
 }
 return <div className="cw-dock" aria-label="代理任务栏">{collapsed&&visible.length?<DockGroup label={`活跃 ${visible.length}`}>{visible.map(pill)}</DockGroup>:visible.map(pill)}{folded.length>0&&<DockGroup label={`非活跃 ${folded.length}`}>{folded.map(pill)}</DockGroup>}<DockGroup label={`用户对话 ${users.length}`}><div className="cw-user-new"><button className="cw-new" onClick={newChat}>＋ New</button><button className="cw-resume" onClick={resumeChat}>Resume</button></div>{users.map(pill)}</DockGroup>{error&&<span role="alert">{error}</span>}</div>
}
function ResumeBrowser({sessionId,call,open}: {sessionId:string;call:Call;open:(w:Worker)=>void}) {
 const [search,setSearch]=useState(''),[rows,setRows]=useState<any[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,retry]=useState(0)
 useEffect(()=>{let disposed=false;setRows([]);setCursor(null);setBusy(true);setError('');const timer=setTimeout(()=>{void call(sessionId,{action:'sessions',search}).then((value:any)=>{if(!disposed){setRows(value.data);setCursor(value.nextCursor)}}).catch(e=>{if(!disposed)setError(String(e))}).finally(()=>{if(!disposed)setBusy(false)})},200);return()=>{disposed=true;clearTimeout(timer)}},[sessionId,call,search,revision])
 const more=async()=>{setBusy(true);setError('');try{const page=await call(sessionId,{action:'sessions',search,cursor:cursor!}) as any;setRows(r=>[...r,...page.data]);setCursor(page.nextCursor)}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section className="cw-chat cw-resume-browser" aria-label="Codex Resume"><input aria-label="搜索 Codex 会话" placeholder="搜索 Codex 会话…" value={search} onChange={e=>setSearch(e.target.value)} /><div className="cw-resume-list">{rows.map(row=><button key={row.id} disabled={busy} onClick={async()=>{setBusy(true);setError('');try{open(await call(sessionId,{action:'adopt',threadId:row.id}) as Worker)}catch(e){setError(String(e))}finally{setBusy(false)}}}><strong>{row.name||row.preview||row.id}</strong><small>{row.cwd}</small><small>{new Date(row.updatedAt*1000).toLocaleString()} · {row.id}</small></button>)}{busy&&<p role="status">正在读取…</p>}{!busy&&!rows.length&&<p>没有可用会话</p>}{cursor&&<button disabled={busy} onClick={()=>void more()}>加载更多</button>}{error&&<p role="alert">{error}<button onClick={()=>retry(n=>n+1)}>重试</button></p>}</div></section>
}
function ModelPicker({ sessionId, call, workerId, initialModel, initialEffort, disabled, submit, onReady }: { workerId?:string; sessionId: string; call: Call; initialModel?: string | null; initialEffort?: Effort | null; disabled?: boolean; submit: (model: string, effort: Effort) => Promise<unknown>; onReady?: (model: string, effort: Effort) => void }) {
  const [catalog, setCatalog] = useState<ModelSettings | null>(null), [model, setModel] = useState(''), [effort, setEffort] = useState<Effort | ''>(''), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  useEffect(() => {
    let disposed = false
    void call(sessionId, { action: 'models', workerId }).then(value => {
      if (disposed) return
      const data = value as ModelSettings; setCatalog(data)
      let saved: { model?: string; effort?: Effort } = {}
      if (onReady) { try { saved = JSON.parse(localStorage.getItem('codex-workers.new-defaults') ?? '{}') ?? {} } catch {} }
      const savedModel = data.models.find(m => m.model === saved.model)
      const selected = initialModel ?? savedModel?.model ?? data.model ?? ''; setModel(selected)
      const savedEffort = savedModel?.supportedReasoningEfforts.some(e => e.reasoningEffort === saved.effort) ? saved.effort : undefined
      const level = initialEffort ?? savedEffort ?? (selected === data.model ? data.effort : null) ?? data.models.find(m => m.model === selected)?.defaultReasoningEffort ?? ''
      setEffort(level); if (selected && level) onReady?.(selected, level)
    }).catch(e => { if (!disposed) setError(String(e)) })
    return () => { disposed = true }
  }, [sessionId, call, initialModel, initialEffort])
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const [isOpen, setOpen] = useState(false)
  const menuId = useId()
  const [pane, setPane] = useState<'root' | 'model' | 'effort'>('root')
  useLayoutEffect(() => {
    if (!isOpen) return
    const place = () => {
      if (!menu.current || !trigger.current) return
      const rect = trigger.current.getBoundingClientRect(), panel = menu.current
      panel.style.left = `${Math.max(12, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 12))}px`
      panel.style.top = `${Math.max(12, Math.min(rect.top - 8 - panel.offsetHeight, window.innerHeight - panel.offsetHeight - 12))}px`
    }
    place(); if (!menu.current?.contains(document.activeElement)) menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [isOpen, pane, catalog])
  const close = () => { menu.current?.hidePopover(); setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    const panel = menu.current
    const toggled = () => setOpen(panel?.matches(':popover-open') ?? false)
    panel?.addEventListener('toggle', toggled)
    return () => panel?.removeEventListener('toggle', toggled)
  }, [])
  const selected = catalog?.models.find(m => m.model === model)
  const effortName = (value: string) => value ? value[0].toUpperCase() + value.slice(1) : '默认'
  const choose = async (nextModel: string, nextEffort: Effort) => {
    setSaving(true); setError('')
    try { await submit(nextModel, nextEffort); setModel(nextModel); setEffort(nextEffort); close() }
    catch (e) { close(); setError(String(e)) }
    finally { setSaving(false) }
  }
  return <div className="cw-model-picker">
    <button ref={trigger} type="button" className="cw-model-trigger" aria-label={`选择模型，当前 ${selected?.displayName ?? model}，推理等级 ${effortName(effort)}`} aria-haspopup="menu" aria-expanded={isOpen} aria-controls={isOpen ? menuId : undefined} disabled={disabled || saving || !catalog} onClick={() => {
      if (isOpen) close()
      else { setPane('root'); menu.current?.showPopover(); setOpen(true) }
    }} onKeyDown={e => { if (e.key === 'ArrowDown' && isOpen) { e.preventDefault(); menu.current?.querySelector<HTMLButtonElement>('button')?.focus() } }}>
      <IconDataOutline16 className="cw-model-icon" /><span className="cw-model-name">{selected?.displayName ?? (model || '读取 Codex 配置…')}</span><span className="cw-model-effort">{effortName(effort)}</span><IconChevronDownOutline14 className="cw-chevron" />
    </button>
    <div ref={menu} id={menuId} {...{ popover: 'auto' }} role="menu" aria-label="模型与推理等级" className="cw-model-menu" onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== trigger.current) close() }} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); if (pane !== 'root') setPane('root'); else close() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        items[((index < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : index) + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
    }}>
      {pane === 'root' ? <>{(['model', 'effort'] as const).map(key => <button type="button" key={key} role="menuitem" className="cw-model-cell" onClick={() => setPane(key)}><span>{key === 'model' ? '模型' : '推理等级'}</span><span className="cw-model-value">{key === 'model' ? selected?.displayName ?? model : effortName(effort)}</span><IconChevronRightOutline14 /></button>)}</> : <>
        <button type="button" role="menuitem" className="cw-model-cell" onClick={() => setPane('root')}>‹ {pane === 'model' ? '模型' : '推理等级'}</button>
        {pane === 'model' ? catalog?.models.map(m => <button type="button" className="cw-model-option" key={m.model} disabled={saving} role="menuitemradio" aria-checked={model === m.model} onClick={() => void choose(m.model, m.defaultReasoningEffort)}><span>{m.displayName}</span><span>{model === m.model ? <IconCheckOutline16 /> : null}</span></button>) : selected?.supportedReasoningEfforts.map(e => <button type="button" className="cw-model-option" key={e.reasoningEffort} disabled={saving} role="menuitemradio" aria-checked={effort === e.reasoningEffort} onClick={() => void choose(model, e.reasoningEffort)}><span>{effortName(e.reasoningEffort)}</span><span>{effort === e.reasoningEffort ? <IconCheckOutline16 /> : null}</span></button>)}
      </>}
    </div>
    {error && <Toast key={error} text={error} anchor={trigger.current?.closest<HTMLElement>('.cw-composer-card')} onDone={() => setError('')} />}
  </div>
}
function Composer({ sessionId, call, newChat, latestAnswer, worker, busy, ready, error, send, stop, picker }: { sessionId: string; call: Call; newChat?: () => void; latestAnswer?: string; worker?: Worker; busy: boolean; ready: boolean; error?: string; send: (text: string, skills: Skill[]) => Promise<boolean>; stop?: () => void; picker: import('react').ReactNode }) {
  const [text, setText] = useState(''), input = useRef<HTMLTextAreaElement>(null), submitting = useRef(false), focusPending = useRef(false)
  const [notice,setNotice] = useState('')
  const command = async (name:string) => {
    setNotice('')
    try {
      if (name === 'skills') { setText('$'); menu.setCaret(1); input.current?.focus(); return }
      if (name === 'model') { input.current?.closest('.cw-composer-card')?.querySelector<HTMLButtonElement>('.cw-model-trigger')?.click() }
      else if (name === 'new') { if (!newChat) throw Error('已在空白对话中'); newChat() }
      else if (name === 'status') setNotice(worker ? `${worker.model ?? '默认模型'} · ${worker.effort ?? '默认强度'} · ${labels[worker.state]} · ${worker.threadId ?? ''}` : '空白对话，发送消息后创建')
      else if (name === 'copy') { if (!latestAnswer) throw Error('暂无可复制的回答'); await writeClipboard(latestAnswer);setNotice('已复制') }
      else if (name === 'compact' || name === 'review') {
        if (!worker || worker.state !== 'idle') throw Error('请在已连接且空闲的对话中执行')
        await call(sessionId,{action:name,workerId:worker.id});setNotice(name==='compact'?'':'已开始审查未提交改动')
      } else throw Error(`此界面尚未接入 /${name}。可用指令：${commands.map(([n])=>'/'+n).join('、')}`)
      setText('')
    } catch(e) { setNotice(String(e)) }
  }
  const menu = useInputMenu({text,setText,input,sessionId,workerId:worker?.id,call,command})
  const id = useId(), running = worker?.state === 'running'
  useEffect(() => { if (!busy && focusPending.current) { focusPending.current = false; input.current?.focus() } }, [busy])
  return <footer className="cw-compose"><div className="cw-composer-card">
    {menu.menu}{notice && <p className="cw-input-notice" role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <form id={id} onSubmit={async e => {
      e.preventDefault(); if (busy || !ready || !text.trim() || submitting.current) return
      submitting.current = true
      try { if (/^\/[a-z][\w-]*(?:\s|$)/i.test(text)) { const parts=text.trim().split(/\s+/); if(parts.length>1) setNotice('请从指令菜单选择操作；此指令不接受文本参数'); else await command(parts[0].slice(1)); } else if (await send(text, menu.selected)) {setText('');menu.clear()} }
      finally { submitting.current = false; focusPending.current = true; input.current?.focus() }
    }}><textarea ref={input} {...menu.aria} onSelect={e=>menu.setCaret(e.currentTarget.selectionStart)} rows={1} aria-label="发送给 Codex" placeholder={running ? '向当前任务插话…' : '发消息或创建任务…'} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if(menu.onKeyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} required disabled={busy || !ready} /></form>
    <div className="cw-composer-toolbar">{picker}{worker && <Meter worker={worker} />}
      {running && <Tooltip label="中断" side="top" delayMs={500} disabled={busy}><button type="button" className="cw-stop" aria-label="中断" disabled={busy} onMouseDown={e => e.preventDefault()} onClick={stop}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" /></svg></button></Tooltip>}
      <Tooltip label={running ? '插话' : '发送'} side="top" delayMs={500} disabled={busy || !ready || !text.trim()}><button className="cw-send" type="submit" form={id} aria-label={running ? '插话' : '发送'} disabled={busy || !ready || !text.trim()} onMouseDown={e => e.preventDefault()}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" /></svg></button></Tooltip>
    </div>
  </div></footer>
}
export function NewConversation({ sessionId, call, open }: { sessionId: string; call: Call; open: (w: Worker) => void }) {
  const [selection, setSelection] = useState<{ model: string; effort: Effort } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const created = useRef<Worker | null>(null), sending = useRef(false)
  return <section className="cw-chat" aria-label="新 Codex 对话"><div className="cw-messages" />
    <Composer sessionId={sessionId} call={call} busy={busy} ready={selection !== null} error={error} send={async (text, skills) => {
      if (!selection || sending.current) return false
      sending.current = true; setBusy(true); setError('')
      try {
        created.current ??= await call(sessionId, { action: 'create', name: text.trim().slice(0, 40), ...selection }) as Worker
        const result = await call(sessionId, { action: 'append', workerId: created.current.id, text, skills }) as { error?: string }
        if (result?.error) throw Error(result.error)
        open(created.current); return true
      } catch (e) { setError(String(e)); return false }
      finally { sending.current = false; setBusy(false) }
    }} picker={<ModelPicker sessionId={sessionId} call={call} disabled={busy || created.current !== null} onReady={(model, effort) => setSelection({ model, effort })} submit={async (model, effort) => { setSelection({ model, effort }); try { localStorage.setItem('codex-workers.new-defaults', JSON.stringify({ model, effort })) } catch {} }} />} />
  </section>
}
export function ConversationPanel({ sessionId, workerId, call, fullscreen = false, newChat, closeChat }: { closeChat?:()=>void; newChat?: () => void; sessionId: string; workerId: string; call: Call; fullscreen?: boolean }) {
  const { workers, error: listError } = useWorkers(sessionId, call)
  const worker = workers.find(w => w.id === workerId)
  const { history, error: historyError, retry } = useConversation(sessionId, workerId, call)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const recovered = useRef(false)
  useEffect(() => {
    if (recovered.current || worker?.state !== 'saved' || worker.savedState !== 'idle') return
    recovered.current = true; setBusy(true); setError('')
    void call(sessionId, { action: 'resume', workerId }).then(retry).catch(e => setError(String(e))).finally(() => setBusy(false))
  }, [sessionId, workerId, worker?.state, worker?.savedState, call])
  const act = async (input: Action): Promise<boolean> => {
    setBusy(true); setError('')
    try { const result = await call(sessionId, { ...input, workerId }) as { error?: string }; if (result?.error) throw Error(result.error); return true }
    catch (e) { setError(String(e)); return false } finally { setBusy(false) }
  }
  if (!worker) return <div className="cw-chat">{listError || '正在加载对话…'}</div>
  return <section className="cw-chat" aria-label={`${worker.name} 对话`}>
    {worker.owner==='user'&&<div className="cw-user-controls"><UserActions worker={worker} call={call} sessionId={sessionId} closed={closeChat}/></div>}
    {worker.state === 'saved' && <p className="cw-caption" role="status">{worker.savedState === 'idle' ? '正在从 Codex 恢复对话…' : '重启前的执行状态尚未确认；可以查看历史，确认旧进程退出后恢复对话。'}</p>}
    <Transcript sessionId={sessionId} worker={worker} history={history} error={error || listError || historyError || worker.error || ''} busy={busy} retry={retry} act={act} fullscreen={fullscreen} footer={<>
    <Composer sessionId={sessionId} call={call} newChat={newChat} latestAnswer={[...(history?.items ?? [])].reverse().find(i=>i.role==='assistant'&&i.phase!=='commentary')?.text ?? worker.reports.at(-1)?.result} worker={worker} busy={busy} ready={['idle', 'running'].includes(worker.state)} send={async (text, skills) => act({ action: worker.state === 'idle' ? 'append' : 'steer', turnId: worker.turnId ?? undefined, text, skills })} stop={() => void act({ action: 'interrupt', turnId: worker.turnId! })} picker={<ModelPicker sessionId={sessionId} call={call} workerId={worker.id} initialModel={worker.model} initialEffort={worker.effort as Effort | undefined} disabled={busy || !['idle', 'running'].includes(worker.state)} submit={async (model, effort) => { setBusy(true); try { await call(sessionId, { action: 'configure', workerId, model, effort }) } finally { setBusy(false) } }} />} />
    {['saved', 'unknown'].includes(worker.state) && <button disabled={busy} onClick={() => { if (worker.state === 'saved' && worker.savedState === 'idle' || window.confirm('恢复前请确认旧 Codex 进程已退出，且没有其他进程正在执行该会话。恢复只载入历史，不重发旧任务。')) void act({ action: 'resume', confirmedStopped: true }).then(ok => { if (ok) retry() }) }}>{busy ? '正在重新连接…' : '恢复对话'}</button>}
    {worker.owner !== 'user' && ['saved', 'unknown'].includes(worker.state) && <button disabled={busy} onClick={() => { if (window.confirm('确认旧 Codex 进程已退出，且没有其他进程正在执行该会话？关闭将移出对话组并保留已有历史，不会尝试恢复会话。')) void act({ action: 'close', confirmedStopped: true }).then(ok => { if (ok) closeChat?.() }) }}>关闭对话</button>}
    </>} />

  </section>
}
const css = nativeStyles + transcriptStyles + `
.cw-native-header{display:grid!important;grid-template-columns:auto minmax(0,1fr);align-items:center}.cw-native-header>:first-child{grid-column:1/-1}.cw-native-header>[role=tablist]{grid-column:1;grid-row:2}.cw-native-header>.cw-dock{grid-column:2;grid-row:2;justify-self:end;justify-content:flex-end;min-width:0}.cw-pill-row{display:flex;align-items:center;gap:4px}.cw-user-pill{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:999px;overflow:visible;padding-right:5px;background:color-mix(in srgb,currentColor 4%,transparent)}.cw-user-pill>.cw-pill{flex:1;min-width:0;border:0;background-color:transparent}.cw-user-pill .cw-usage{margin-left:auto}.cw-user-pill .cw-type{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cw-user-pill .cw-user-actions{padding-right:2px}.cw-user-actions{display:inline-flex;flex:none;gap:2px}.cw-user-actions button,.cw-chat .cw-user-actions button{display:grid;place-items:center;box-sizing:border-box;padding:0;width:26px;height:26px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}.cw-user-actions button:hover{background:var(--dsw-alias-interactive-bg-hover)}.cw-user-controls{display:flex;justify-content:flex-end;padding:4px 12px}.cw-user-new{display:flex;gap:6px}.cw-resume-browser{padding:12px;box-sizing:border-box;gap:12px}.cw-resume-browser>input{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-input-major);color:inherit;font:inherit}.cw-resume-list{overflow:auto;min-height:0}.cw-chat .cw-resume-list>button{display:flex;flex-direction:column;gap:4px;text-align:left;width:100%;border:0;padding:12px;border-radius:10px;white-space:normal}.cw-resume-list>button:hover{background:var(--dsw-alias-interactive-bg-hover)}.cw-resume-list strong{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}.cw-resume-list small{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.cw-dock{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 0;font-size:12px}.cw-pill,.cw-fold-trigger,.cw-new{display:inline-flex;align-items:center;gap:6px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:999px;padding:5px 10px;background:color-mix(in srgb,currentColor 4%,transparent);color:inherit;cursor:pointer;font:inherit}.cw-pill:hover,.cw-fold-trigger:hover,.cw-new:hover{background:color-mix(in srgb,currentColor 10%,transparent)}.cw-pill:focus-visible,.cw-fold-trigger:focus-visible,.cw-new:focus-visible{outline:2px solid #548de9;outline-offset:2px}.cw-type{font-weight:600}.cw-usage{font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:6px}.cw-muted{opacity:.65}.cw-context-ring{display:inline-flex;flex-shrink:0;color:var(--dsw-alias-label-secondary,#81858c);border-radius:50%}.cw-context-ring:focus-visible{outline:2px solid #548de9;outline-offset:2px}.cw-meter{display:inline-flex;align-items:center;gap:5px;font-size:11px;white-space:nowrap}.cw-track{width:34px;height:4px;border-radius:4px;background:color-mix(in srgb,currentColor 15%,transparent);overflow:hidden;display:inline-block}.cw-track>span{display:block;height:100%;background:#729ce1}.cw-role-list{max-height:240px;overflow:auto;padding:8px;max-width:440px}.cw-role-list p{margin:4px 0}.cw-role-list>div{padding:6px 0}.cw-fold{position:relative}.cw-fold-list{position:absolute;top:100%;right:0;z-index:100;display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:10px;min-width:max-content;max-height:240px;overflow:auto;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;box-shadow:0 6px 24px #0002}.cw-chat{height:100%;min-height:0;display:flex;flex-direction:column;color:inherit;font-size:13px}.cw-chat-header{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:14px;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent)}.cw-chat-header>strong{flex-basis:100%}.cw-messages{flex:1;min-height:0;overflow:auto;padding:14px;overflow-wrap:anywhere}.cw-message{margin-bottom:16px;border-radius:10px;padding:10px;background:color-mix(in srgb,currentColor 4%,transparent)}.cw-user{margin-left:22px;background:color-mix(in srgb,#729ce1 13%,transparent)}.cw-message small{opacity:.65}.cw-chat pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:6px 0}.cw-tool{font-size:12px}.cw-compose{padding:12px}.cw-composer-card{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));border-radius:22px;background:var(--dsw-specific-input-major,Canvas);box-shadow:var(--dsw-elevation-soft,0 2px 12px #0001);border:0;--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);padding:8px 0 0}.cw-composer-card textarea{box-sizing:border-box;display:block;resize:none;field-sizing:content;width:100%;min-height:36px;max-height:var(--dsh-composer-text-max-height,200px);border:0;outline:none;background:transparent;color:inherit;padding:4px 14px 0;font:inherit;line-height:inherit}.cw-composer-card textarea::placeholder{color:var(--dsw-alias-text-tertiary,#a6abb3)}.cw-composer-card:focus-within{border-color:var(--dsw-alias-border-l3,#8885)}.cw-composer-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:2px 8px 6px;min-width:0}.cw-chat button{border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:7px;padding:5px 9px;cursor:pointer;color:inherit;background:transparent;white-space:nowrap}.cw-chat .cw-send,.cw-chat .cw-stop{display:grid;place-items:center;flex-shrink:0;width:34px;height:34px;padding:0;border:0;border-radius:999px;corner-shape:round}.cw-chat .cw-send{background:var(--dsw-alias-button-info-fill,#3964fe);color:white;transform:translateY(-2px)}.cw-chat .cw-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,#3259e5)}.cw-chat .cw-stop{background:color-mix(in srgb,currentColor 7%,transparent)}.cw-chat button:focus-visible,.cw-chat select:focus-visible{outline:2px solid #548de9;outline-offset:2px}.cw-chat button:disabled{opacity:.4;cursor:default}.cw-report{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:11px;margin-bottom:10px}
.cw-composer-card{position:relative}.cw-input-menu{position:absolute;bottom:calc(100% + 4px);left:0;right:0;z-index:100;max-height:320px;overflow:hidden;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);padding:4px;display:flex;flex-direction:column;border:0;border-radius:20px;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent)}.cw-input-menu [role=listbox]{display:flex;flex-direction:column;min-height:0;overflow-y:auto}.cw-input-menu-title{padding:8px 10px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.cw-chat .cw-input-option{display:flex;align-items:center;gap:8px;width:100%;flex-shrink:0;min-height:40px;padding:8px 10px;border:0;border-radius:10px;background:transparent;cursor:pointer;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);text-align:left}.cw-chat .cw-input-option[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover)}.cw-input-name{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cw-input-description{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}.cw-input-notice{margin:4px 14px;font-size:12px;overflow-wrap:anywhere}.cw-model-picker {
  position: relative;
  min-width: 0;
}


.cw-chat .cw-model-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;

  max-width: 220px;
  max-width: min(360px, 45cqw);
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;

  border-radius: 24px;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}

.cw-chat .cw-model-trigger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.cw-chat .cw-model-trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);
}

.cw-chat .cw-model-trigger:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.cw-model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}


.cw-model-effort {
  flex-shrink: 1000;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-caption);
}


.cw-model-icon {
  display: none;
  flex: 0 0 auto;
}


@container (max-width: 360px) {
  .cw-model-icon {
    display: block;
  }

  .cw-model-name,
  .cw-model-effort {
    display: none;
  }
}

.cw-chevron {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  transition: transform 120ms ease;
}

.cw-model-chevronOpen {
  transform: rotate(180deg);
}


.cw-model-menu {
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;

  width: max-content;
  min-width: min(240px, calc(100vw - 32px));
  max-width: min(420px, calc(100vw - 32px));
  max-height: min(360px, calc(100vh - 96px));
  overflow: hidden;
  padding: 4px;

  border: 0;
  border-radius: 20px;
  background: var(--dsw-specific-menu);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);

  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.cw-model-status,
.cw-model-empty {
  padding: 10px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}

.cw-model-error,
.cw-model-warning {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  padding: 7px 8px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}

.cw-model-warning {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-state-warn-label);
}

.cw-model-retry {
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.cw-model-groups {
  min-height: 0;
  overflow-y: auto;
}

.cw-model-group + .cw-model-group {
  margin-top: 4px;
}

.cw-model-groupTitle {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 5px 8px 3px;
  background: var(--dsw-specific-menu);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
}

.cw-chat .cw-model-option {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: auto;
  min-width: 100%;
  min-height: 38px;
  padding: 6px 8px;
  border: none;
  border-radius: 10px;
  outline: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.cw-chat .cw-model-option:hover:not(:disabled),
.cw-chat .cw-model-option:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
}


.cw-model-selected {
  background: transparent;
}

.cw-chat .cw-model-option:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.cw-chat .cw-model-optionCopy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.cw-model-modelName {
  overflow: hidden;
  color: inherit;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cw-model-check {
  display: grid;
  place-items: center;
  flex: 0 0 18px;
  color: var(--dsw-alias-label-primary);
}


.cw-chat .cw-model-cell {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: auto;
  min-width: 100%;
  height: 40px;
  padding: 0 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  text-align: left;
}

.cw-chat .cw-model-cell:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.cw-chat .cw-model-cellLabel {
  flex: 0 0 auto;
  white-space: nowrap;
}

.cw-model-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  color: var(--dsw-alias-label-tertiary);
}

.cw-chat .cw-model-cellChevron {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
}

.cw-model-menu:not(:popover-open){display:none}
.cw-model-menu{inset:auto;margin:0;overflow-y:auto}.cw-model-picker:has(:popover-open) .cw-chevron{transform:rotate(180deg)}
.cw-chat .cw-model-trigger:disabled{opacity:1}.cw-model-option>span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:500;font-size:14px}.cw-model-option>span:last-child{display:grid;place-items:center;width:18px;flex:none}.cw-model-cell>svg{color:var(--dsw-alias-label-tertiary);flex:none}
.cw-composer-toolbar{container-type:inline-size;flex-wrap:wrap}.cw-model-effort{flex-shrink:1000;min-width:0;overflow:hidden;text-overflow:ellipsis}.cw-model-icon{display:none}
@container (max-width:360px){.cw-model-icon{display:block}.cw-model-name,.cw-model-effort{display:none}}
.cw-chat .cw-model-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.cw-chat .cw-stop{background:var(--dsw-alias-button-info-fill);color:#fff;transform:translateY(-2px)}.cw-chat .cw-stop:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
.cw-composer-card textarea{font-family:var(--dsw-font-family);padding:4px 8px 0 14px;width:calc(100% - 4px);color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);overflow-wrap:anywhere}
.cw-composer-card textarea::placeholder{color:var(--dsw-alias-label-caption);white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.cw-context-root{display:inline-flex;position:relative}.cw-chat .cw-context-ring{display:grid;place-items:center;flex:none;width:28px;height:28px;border:0;border-radius:999px;corner-shape:round;background:transparent;color:var(--dsw-alias-label-secondary);padding:0;cursor:pointer}.cw-chat .cw-context-ring:hover{background:var(--dsw-alias-interactive-bg-hover)}
.cw-chat .cw-model-cell:focus-visible,.cw-chat .cw-model-option:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}
.cw-context-panel{inset:auto;margin:0;position:fixed;box-sizing:border-box;width:264px;max-width:calc(100vw - 24px);padding:12px;border:0;border-radius:12px;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}.cw-context-panel>strong{float:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}.cw-context-bar{height:4px;margin:10px 0 12px;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;overflow:hidden}.cw-context-bar>span{display:block;height:100%;background:var(--dsw-alias-label-tertiary)}

`
export function apply(ctx: Context): void {
  const call: Call = async (sessionId, input) => {
    const result = await ctx.connection.rpc.call('/codex-workers', 'action', { sessionId, input })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const viewListeners = new Set<()=>void>()
  const changed = () => viewListeners.forEach(fn=>fn())
  let currentView: { sessionId: string; workerId: string } | undefined
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); return () => style.remove() })
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: 'codex-worker', kind: 'codex-worker', title: () => 'Codex 对话' }))
  function HeaderDock({sessionId}: {sessionId:string}) {
    const anchor=useRef<HTMLSpanElement>(null),[header,setHeader]=useState<HTMLElement|null>(null)
    const collapsed=useSyncExternalStore(fn=>{viewListeners.add(fn);return()=>{viewListeners.delete(fn)}},()=>!!currentView&&currentView.sessionId===sessionId&&ctx.sidebarRight.isExpanded())
    useLayoutEffect(()=>{const node=anchor.current?.closest('header');if(!node)return;node.classList.add('cw-native-header');setHeader(node);return()=>node.classList.remove('cw-native-header')},[])
    return <><span ref={anchor} hidden />{header&&createPortal(<Dock sessionId={sessionId} call={call} collapsed={collapsed} open={w=>toggleWorker(ctx.sidebarRight,currentView,sessionId,w)} newChat={()=>ctx.sidebarRight.openTab('codex-worker',{params:{workerId:'new'}})} resumeChat={()=>ctx.sidebarRight.openTab('codex-worker',{params:{workerId:'resume'}})} closed={w=>{if(currentView?.workerId===w.id&&ctx.sidebarRight.isExpanded())ctx.sidebarRight.toggleExpanded()}} />,header)}</>
  }
  ctx.slots.inject('conversation.session.header.utilities',()=>ctx.slots.register({name:'conversation.session.header.utilities',id:'codex-workers',order:21},({sessionId})=><HeaderDock key={sessionId} sessionId={sessionId}/>))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'codex-worker' }, ({ sessionId, useTabInfo }) => {
    const { tab, sidebar } = useTabInfo()
    const params = tab.navigation.params
    const workerId = params && 'workerId' in params ? params.workerId : undefined
    useEffect(() => {
      if (!workerId || !tab.visible) return
      const view = { sessionId, workerId }; currentView = view; changed()
      return () => { if (currentView === view) { currentView = undefined; changed() } }
    }, [sessionId, workerId, tab.visible])
    if (!workerId || !tab.visible) return null
    if (workerId === 'resume') return <ResumeBrowser sessionId={sessionId} call={call} open={w=>ctx.sidebarRight.openTab('codex-worker',{params:{workerId:w.id}})}/>
    if (workerId === 'new') return <NewConversation key={sessionId} sessionId={sessionId} call={call} open={w => ctx.sidebarRight.openTab('codex-worker', { params: { workerId: w.id } })} />
    return <ConversationPanel key={`${sessionId}/${workerId}`} sessionId={sessionId} workerId={workerId} call={call} fullscreen={sidebar.fullscreen} closeChat={()=>ctx.sidebarRight.toggleExpanded()} newChat={() => ctx.sidebarRight.openTab('codex-worker', {params:{workerId:'new'}})} />
  }))
}
