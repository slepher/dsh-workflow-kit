import { compactionTurnIds } from './types.js'
import type { ReactNode, CSSProperties } from 'react'
import { TurnStats, SessionStats, reportUsage } from './stats.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MarkdownText, IconCopyOutline16, IconCheckOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDownOutline14 } from './native-icons.js'
import { Tooltip } from './native-Tooltip.js'
import type { Action, Conversation, ConversationItem, Worker } from './types.js'
type Call = (sessionId: string, input: Action) => Promise<unknown>
const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }

export function mergeEvent(history: Conversation, event: any): Conversation {
  if (event.type === 'turn' && event.turn?.id) return { ...history, turns: [...(history.turns ?? []).filter(t => t.id !== event.turn.id), event.turn] }
  const item = event.type === 'item' ? event.item : event.type === 'delta' && typeof event.delta === 'string' ? { id: event.itemId, turnId: event.turnId, role: event.role, text: '' } : undefined
  if (!item?.id || !item.turnId) return history
  const items = [...history.items], index = items.findIndex(i => i.id === item.id && i.turnId === item.turnId)
  if (event.type === 'delta') {
    const previous = items[index] ?? item
    const next = { ...previous, text: previous.text + event.delta, ...(event.role === 'tool' ? { output: (previous.output ?? '') + event.delta } : {}) }
    if (index < 0) items.push(next); else items[index] = next
  } else if (index < 0) items.push(item); else items[index] = item
  return { ...history, items }
}
export function useConversation(sessionId: string, workerId: string, call: Call) {
  const [history, setHistory] = useState<Conversation | null>(null), [error, setError] = useState(''), [revision, retry] = useState(0)
  useEffect(() => {
    let disposed = false, connected = false, timer: ReturnType<typeof setTimeout>, pending: any[] = [], reading = false
    setHistory(null); setError('')
    const read = async () => {
      if (reading) return
      reading = true; pending = []
      try {
        const value = await call(sessionId, { action: 'conversation', workerId }) as Conversation
        if (!disposed) { setHistory(pending.reduce(mergeEvent, value)); setError('') }
      } catch (e) { if (!disposed) setError(String(e)) }
      finally { reading = false; if (!disposed && !connected) timer = setTimeout(read, 2000) }
    }
    // Subscribe before loading the snapshot, retaining events that arrive during the read.
    const stream = typeof EventSource === 'undefined' ? undefined : new EventSource(`/codex-workers/events?${new URLSearchParams({ sessionId, workerId })}`)
    stream?.addEventListener('ready', () => { connected = true; clearTimeout(timer); void read() })
    if (stream) {
      stream.onmessage = event => { const value = JSON.parse(event.data); if (reading) pending.push(value); setHistory(h => h ? mergeEvent(h, value) : h); if (value.type === 'turn' && value.turn.status !== 'inProgress') void read() }
      stream.onerror = () => { connected = false; clearTimeout(timer); timer = setTimeout(read, 2000) }
    }
    void read()
    return () => { disposed = true; clearTimeout(timer); stream?.close() }
  }, [sessionId, workerId, call, revision])
  return { history, error, retry: () => retry(r => r + 1) }
}
function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1000); return () => clearTimeout(timer) }, [copied])
  return <Tooltip label={copied ? '已复制' : '复制'} side="top" delayMs={500}><button type="button" className="cw-icon-action" aria-label="复制消息" onClick={() => void writeClipboard(text).then(setCopied)}>{copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}</button></Tooltip>
}
const stateLabel = (status?: string) => ({ inProgress: '运行中', completed: '完成', failed: '失败', interrupted: '已中断', declined: '已拒绝' }[status ?? ''] ?? status ?? '')
const mediaUrl = (url: string) => url.startsWith('/') && !url.startsWith('//') ? `/api/file?path=${encodeURIComponent(url)}` : /^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(url) ? url : undefined
function Message({ item, actions }: { item: ConversationItem; actions?: ReactNode }) {
  const preview = useRef<HTMLDialogElement>(null), [image, setImage] = useState('')
  return <article className={`cw-entry cw-entry-${item.role}`}>
    {item.role === 'user' ? <div className="cw-user-bubble">{item.text}</div> : <MarkdownText labels={markdownLabels} pathImages={{resolve:mediaUrl}} text={item.text} streaming={item.status === 'inProgress'} />}
    {item.images?.filter(mediaUrl).map((url, index) => <button className="cw-image-button" aria-label="预览图片" key={index} onClick={() => { setImage(mediaUrl(url)!); preview.current?.showModal() }}><img className="cw-message-image" src={mediaUrl(url)} alt="消息附件" loading="lazy" /></button>)}
    {item.files?.map(file => <a key={file.path} href={mediaUrl(file.path)} target="_blank" rel="noreferrer">{file.name || file.path}</a>)}
    {!!item.images?.length && <dialog className="cw-image-preview" ref={preview} onClick={e => { if (e.target === e.currentTarget) preview.current?.close() }}><button aria-label="关闭图片预览" onClick={() => preview.current?.close()}>×</button><img src={image || undefined} alt="消息图片预览" /></dialog>}
    <div className="cw-message-actions"><Copy text={item.text} />{actions}</div>
  </article>
}
function CompactionRow({status,error}: {status?: string; error?: string}) {
  const label = status === 'inProgress' ? '正在压缩…' : status === 'failed' ? '压缩失败' : status === 'interrupted' ? '压缩已中断' : status === 'unknown' ? '压缩状态待确认' : '压缩完成'
  const row = <div className="cw-command-row" data-state={status} role={status==='inProgress'?'status':undefined}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor"/><path d="m4 5 3 3-3 3m5 0h3" fill="none" stroke="currentColor"/></svg><span>compact</span><i aria-hidden="true"/><span className="cw-command-summary">{label}</span></div>
  return error ? <details className="cw-command" ><summary>{row}</summary><pre className="cw-command-error">{error}</pre></details> : <div className="cw-command">{row}</div>
}
function Tool({ item, opened, toggle }: { item: ConversationItem; opened: boolean; toggle: (open: boolean) => void }) {
  if (item.kind === 'contextCompaction') return <CompactionRow status={item.status} />
  return <details className="cw-tool-row" open={opened} onToggle={e => toggle(e.currentTarget.open)}>
    <summary><span className={`cw-tool-state cw-state-${item.status}`} aria-label={stateLabel(item.status)}>●</span><span>{item.title ?? item.kind ?? '工具'}</span><small>{stateLabel(item.status)}{item.durationMs !== undefined ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ''}</small></summary>
    {item.cwd && <div className="cw-caption">工作目录：{item.cwd}</div>}
    {item.arguments !== undefined && <pre>{JSON.stringify(item.arguments, null, 2)}</pre>}
    {item.changes?.map((change, index) => <details key={index} className="cw-file-change"><summary>{change.path} · {change.kind}</summary><a href={mediaUrl(change.path)} target="_blank" rel="noreferrer">打开文件</a><MarkdownText labels={markdownLabels} text={'```diff\n' + change.diff + '\n```'} /></details>)}
    {!item.changes && <pre className="cw-tool-output">{item.output ?? item.text}</pre>}
    {item.exitCode !== undefined && <div className="cw-caption">退出码：{item.exitCode}</div>}
    <Copy text={item.text} />
  </details>
}
export function Transcript({ sessionId, worker, history, error, busy, retry, act, footer, fullscreen = false }: { footer?: ReactNode; fullscreen?: boolean; sessionId: string; worker: Worker; history: Conversation | null; error: string; busy: boolean; retry: () => void; act: (action: Action) => Promise<boolean> }) {
  const storageKey = `codex-workers.view:${sessionId}:${worker.id}`
  const [view, setView] = useState<{ top: number; folds: Record<string, boolean> }>(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') ?? { top: -1, folds: {} } } catch { return { top: -1, folds: {} } } })
  const scroll = useRef<HTMLDivElement>(null), following = useRef(view.top < 0), restored = useRef(false), state = useRef(view)
  const shell = useRef<HTMLDivElement>(null), dock = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({width:0,height:0,dock:0}), [preview, setPreview] = useState<number | null>(null)
  const [preferred, setPreferred] = useState<number | null>(() => { try { const n = Number(localStorage.getItem('codex-workers.contentWidth')); return n >= 640 ? n : null } catch { return null } })
  const wide = fullscreen && size.width > 900
  const contentWidth = wide ? Math.min(size.width - 176, Math.max(640, preferred ?? Math.max(680, Math.min(size.width * .64, 920)))) : undefined
  const saveWidth = (width: number) => { const n = Math.max(640, Math.min(size.width - 176, width)); setPreferred(n); try { localStorage.setItem('codex-workers.contentWidth', String(n)) } catch {} }
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !shell.current) return
    const observer = new ResizeObserver(() => setSize({width:shell.current!.clientWidth,height:shell.current!.clientHeight,dock:dock.current?.offsetHeight ?? 0}))
    observer.observe(shell.current); if (dock.current) observer.observe(dock.current)
    return () => observer.disconnect()
  }, [])
  const [atBottom, setBottom] = useState(true), [activeTurn, setActiveTurn] = useState(0)
  state.current = view
  const maintenanceIds = compactionTurnIds(history)
  for (const c of worker.compactions ?? []) if(c.turnId) maintenanceIds.add(c.turnId)
  const turns = [...new Set([...(history?.items.map(i => i.turnId) ?? []), ...(history?.turns?.map(t => t.id) ?? []), ...worker.reports.map(r => r.turnId), ...(worker.turnId ? [worker.turnId] : [])])]
  const taskTurns = turns.map((id,index)=>({id,index})).filter(t=>!maintenanceIds.has(t.id))
  const bottom = () => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; following.current = true; setBottom(true) }
  const remember = () => { try { sessionStorage.setItem(storageKey, JSON.stringify(state.current)) } catch {} }
  useEffect(() => () => remember(), [storageKey])
  useLayoutEffect(() => {
    const element = scroll.current; if (!element || !history) return
    if (!restored.current) { if (view.top >= 0) element.scrollTop = view.top; else bottom(); restored.current = true }
    else if (following.current) bottom()
    setBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 40)
  }, [history])
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !scroll.current) return
    const observer = new ResizeObserver(() => { if (following.current) bottom() })
    const content = scroll.current.firstElementChild; if (content) observer.observe(content)
    return () => observer.disconnect()
  }, [])
  const fold = (key: string, open: boolean) => setView(v => v.folds[key] === open ? v : { ...v, folds: { ...v.folds, [key]: open } })
  const jump = (index: number) => { scroll.current?.querySelector<HTMLElement>(`[data-turn-index="${index}"]`)?.scrollIntoView({block:'start'}); following.current = false }
  return <div ref={shell} className="cw-transcript-shell" style={{'--cw-content-width':contentWidth ? `${contentWidth}px` : '100%', '--cw-dock-height':`${size.dock}px`} as CSSProperties}>
    {wide && <><nav className="cw-turn-rail" aria-label="轮次导航" style={{maxHeight:Math.max(40,size.height-size.dock-32)}}>{taskTurns.map(({id,index},number) => <button key={id} aria-label={`第 ${number+1} 轮`} aria-current={activeTurn === index ? 'step' : undefined} onMouseEnter={() => setPreview(index)} onMouseLeave={() => setPreview(null)} onFocus={() => setPreview(index)} onBlur={() => setPreview(null)} onClick={() => jump(index)} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling; (next as HTMLElement | null)?.focus() } }}><span /></button>)}</nav>{preview !== null && <div className="cw-rail-preview"><strong>{history?.items.find(i => i.turnId === turns[preview] && i.role === 'user')?.text || `第 ${preview+1} 轮`}</strong><p>{[...(history?.items ?? [])].reverse().find(i => i.turnId === turns[preview] && i.role === 'assistant')?.text || worker.reports.find(r => r.turnId === turns[preview])?.result}</p></div>}{([-1,1] as const).map(side => <div key={side} className="cw-width-handle" role="separator" aria-label="调整对话宽度" aria-orientation="vertical" aria-valuemin={640} aria-valuemax={Math.floor(size.width-176)} aria-valuenow={Math.round(contentWidth!)} tabIndex={0} style={{left:`calc(50% + ${side*contentWidth!/2}px)`}} onDoubleClick={() => { setPreferred(null); localStorage.removeItem('codex-workers.contentWidth') }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); saveWidth(contentWidth! + (e.key === 'ArrowRight' ? 20 : -20)*side) } }} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.origin = `${e.clientX},${contentWidth}` }} onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const [x,width] = e.currentTarget.dataset.origin!.split(',').map(Number); saveWidth(width+(e.clientX-x)*2*side) }} />)}</>}

    {fullscreen && !wide && taskTurns.length > 1 && <label className="cw-turn-nav">轮次 <select aria-label="跳转轮次" value="" onChange={e => { scroll.current?.querySelector<HTMLElement>(`[data-turn-index="${e.target.value}"]`)?.scrollIntoView({ block: 'start' }); following.current = false }}><option value="">跳转到…</option>{taskTurns.map(({id,index},number) => <option key={id} value={index}>{number + 1}. {history?.items.find(i => i.turnId === id && i.role === 'user')?.text.slice(0, 36) || '执行记录'}</option>)}</select></label>}
    <div ref={scroll} className="cw-transcript" onScroll={e => { const el = e.currentTarget; const top = el.getBoundingClientRect().top; const visible = [...el.querySelectorAll<HTMLElement>('.cw-turn:not([data-maintenance])')].filter(n => n.getBoundingClientRect().top <= top + 80); setActiveTurn(Number(visible.at(-1)?.dataset.turnIndex ?? 0)); following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; setBottom(following.current); setView(v => ({ ...v, top: following.current ? -1 : el.scrollTop })) }}>
      <div className="cw-transcript-content">
        {error && <div className="cw-error" role="alert">{error}<button disabled={busy} onClick={retry}>重新读取</button></div>}
        {!history && !error && <p role="status" className="cw-caption">正在加载对话…</p>}
        {history?.source === 'reports' && <p className="cw-caption">当前显示已保存报告。</p>}
        {turns.map((id, index) => {
          const items = history?.items.filter(i => i.turnId === id) ?? [], meta = history?.turns?.find(t => t.id === id), report = worker.reports.find(r => r.turnId === id)
          const operation = worker.compactions?.find(c=>c.turnId===id), maintenance = maintenanceIds.has(id)
          if (maintenance) return <section data-maintenance="" className="cw-turn" data-turn-index={index} key={id}><CompactionRow status={meta?.status ?? operation?.status} error={meta?.error ?? operation?.error} /></section>
          const final = [...items].reverse().find(i => i.role === 'assistant' && i.phase !== 'commentary'), process = items.filter(i => i.role !== 'user' && i !== final)
          const pending = worker.turnId === id && ['running', 'starting', 'interrupt-requested'].includes(worker.state)
          const approvals = worker.turnId === id ? worker.approvals ?? [] : []
          return <section className="cw-turn" data-turn-index={index} key={id}>
            {items.filter(i => i.role === 'user').map(i => <Message item={i} key={i.id} />)}
            {process.length > 0 && <details className="cw-process" open={view.folds[id] ?? pending} onToggle={e => fold(id, e.currentTarget.open)}><summary>{pending ? '执行中' : '执行过程'} · {process.filter(i => i.role === 'tool' && i.kind !== 'contextCompaction').length} 次工具调用</summary><div>{process.map(i => i.role === 'tool' ? <Tool key={i.id} item={i} opened={view.folds[i.id] ?? false} toggle={open => fold(i.id, open)} /> : <Message key={i.id} item={i} />)}</div></details>}
            {final && <Message item={final} actions={<TurnStats usage={reportUsage(report,history)} durationMs={meta?.durationMs} completedAt={meta?.completedAt} />} />}
            {!final && report?.result && <Message item={{ id: id + '-report', turnId: id, role: 'assistant', text: report.result }} actions={<TurnStats usage={reportUsage(report,history)} durationMs={meta?.durationMs} completedAt={meta?.completedAt ?? (typeof report.createdAt === 'number' ? report.createdAt / 1000 : Date.parse(report.createdAt) / 1000)} />} />}
            {pending && <p className="cw-caption" role="status">{approvals.length ? '等待批准' : 'Codex 正在运行…'}</p>}
            {approvals.map(q => { const params = q.params as any; return <article className="cw-approval" key={q.id}><strong>需要批准</strong><pre>{params?.command ?? params?.reason ?? q.method}</pre>{params?.cwd && <p>工作目录：{params.cwd}</p>}{params?.reason && params.reason !== params.command && <p>{params.reason}</p>}<details><summary>请求详情</summary><pre>{JSON.stringify(params, null, 2)}</pre></details><div className="cw-approval-actions"><button disabled={busy} onClick={() => void act({ action: 'approve', approvalId: q.id, decision: 'accept' })}>批准本次请求</button><button disabled={busy} onClick={() => void act({ action: 'approve', approvalId: q.id, decision: 'decline' })}>拒绝</button></div></article> })}
            {(meta?.error || report?.error) && <div className="cw-error" role="alert">{meta?.error ?? report?.error}</div>}
            <div className="cw-turn-tail">{worker.owner !== 'user' && report && <><span>{stateLabel(report.status)}</span><span>{report.acceptance === 'accepted' ? '验收通过' : report.acceptance === 'changes-requested' ? '要求修改' : '待验收'}</span>{!report.acknowledgedAt && <button disabled={busy} onClick={() => void act({ action: 'ack', turnId: id })}>确认已读</button>}{report.acceptance === 'pending' && <><button disabled={busy} onClick={() => void act({ action: 'accept', turnId: id, acceptance: 'accepted' })}>验收通过</button><button disabled={busy} onClick={() => void act({ action: 'accept', turnId: id, acceptance: 'changes-requested' })}>要求修改</button></>}</>}</div>
          </section>
        })}
      </div>
      {(worker.compactions ?? []).filter(c=>c.turnId===null).map(c=><CompactionRow key={c.id} status={c.status} error={c.error} />)}
      <div ref={dock} className="cw-floating-dock">{footer}<SessionStats worker={worker} history={history} /></div>
    </div>
    {!atBottom && <Tooltip label="返回最新消息" side="top" delayMs={200}><button className="cw-to-bottom" aria-label="返回最新消息" onClick={bottom}><IconChevronDownOutline14 /></button></Tooltip>}
  </div>
}
