import { compactionTurnIds } from './types.js'
import { createPortal } from 'react-dom'
import { IconDatabaseOutline16, IconClockOutline16, IconGaugeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { useStatDialog, MEASURE_STYLE } from './native-stat-dialog.js'
import type { ReactNode } from 'react'
import type { UsageValues, Worker, Conversation, Report } from './types.js'
const tokens = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
const duration = (ms: number) => ms < 60000 ? `${Math.round(ms / 1000)}秒` : `${Math.floor(ms / 60000)}分${Math.round(ms % 60000 / 1000)}秒`
export function reportUsage(report: Report | undefined, history: Conversation | null): UsageValues | undefined {
  if (report?.turnUsage) return report.turnUsage
  // A complete thread read establishes a zero baseline for its actual first turn.
  if (report && history?.source === 'thread' && history.turns?.[0]?.id === report.turnId) return report.usage?.total
}
export function usageRows(usage: UsageValues): [string, string][] {
  const rows: [string, string][] = []
  const add = (label: string, n: number | null) => { if (n !== null) rows.push([label, n.toLocaleString()]) }
  add('总用量', usage.totalTokens)
  if (usage.inputTokens !== null && usage.cachedInputTokens !== null) {
    add('未缓存输入', Math.max(0, usage.inputTokens - usage.cachedInputTokens))
    if (usage.inputTokens > 0) rows.push(['缓存命中', `${Math.round(100 * usage.cachedInputTokens / usage.inputTokens)}%`])
  } else add('输入', usage.inputTokens)
  add('缓存读取', usage.cachedInputTokens); add('缓存写入', usage.cacheWriteInputTokens)
  add('输出', usage.outputTokens); add('推理输出', usage.reasoningOutputTokens)
  return rows
}
function Stat({ label, title, rows, icon }: { label: string; title: string; rows: [string, string][]; icon: ReactNode }) {
  const seat = useStatDialog()
  return <span ref={seat.rootRef}><button className="cw-stat" type="button" aria-expanded={seat.open} onClick={() => seat.setOpen(!seat.open)}>{icon}{label}</button>{seat.open && createPortal(<div ref={seat.panelRef} role="dialog" aria-label={title} className="cw-stat-panel" style={seat.pos ?? MEASURE_STYLE}><div className="cw-stat-title">{title}</div><dl>{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></div>, document.body)}</span>
}
export function TurnStats({ usage, durationMs, completedAt }: { usage?: UsageValues; durationMs?: number; completedAt?: number }) {
  return <>{usage?.totalTokens != null && <Stat icon={<IconDatabaseOutline16 />} label={`用量 ${tokens(usage.totalTokens)} tok`} title="本轮用量" rows={usageRows(usage)} />}{durationMs !== undefined && <Stat icon={<IconClockOutline16 />} label={`用时 ${duration(durationMs)}`} title="本轮用时" rows={[[ '实际用时', duration(durationMs) ]]} />}{completedAt !== undefined && <time title={new Date(completedAt * 1000).toLocaleString()} dateTime={new Date(completedAt * 1000).toISOString()}>{new Date(completedAt * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>}</>
}
export function SessionStats({ worker, history }: { worker: Worker; history: Conversation | null }) {
  const maintenance = compactionTurnIds(history)
  for (const c of worker.compactions ?? []) if(c.turnId) maintenance.add(c.turnId)
  const turns = new Set([...(history?.turns?.map(t => t.id) ?? []), ...(history?.items.map(i => i.turnId) ?? []), ...worker.reports.map(r => r.turnId)])
  for (const id of maintenance) turns.delete(id)
  const times = history?.turns?.filter(t=>!maintenance.has(t.id)).flatMap(t => t.durationMs === undefined ? [] : [t.durationMs]) ?? []
  const toolTimes = history?.items.flatMap(i => i.role === 'tool' && i.kind !== 'contextCompaction' && i.durationMs !== undefined ? [i.durationMs] : []) ?? []
  const rows: [string,string][] = [['轮数', String(turns.size)]]
  if (times.length) rows.push(['累计轮次用时', duration(times.reduce((a,b) => a+b,0))])
  if (toolTimes.length) rows.push(['工具用时', duration(toolTimes.reduce((a,b) => a+b,0))])
  const usage = worker.usage?.total
  return <div className="cw-session-stats"><Stat icon={<IconGaugeOutline16 />} label={`${turns.size} 轮${times.length ? ` · ${duration(times.reduce((a,b) => a+b,0))}` : ''}`} title="会话用时" rows={rows} />{usage?.totalTokens != null && <Stat icon={<IconDatabaseOutline16 />} label={`${tokens(usage.totalTokens)} tok${usage.inputTokens && usage.cachedInputTokens !== null ? ` · 缓存命中 ${Math.round(100*usage.cachedInputTokens/usage.inputTokens)}%` : ''}`} title="会话总用量" rows={usageRows(usage)} />}</div>
}
