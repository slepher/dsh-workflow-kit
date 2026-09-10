import type { Conversation, ConversationItem } from './types.js'

const number = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
/** Keep public item structure; reasoning content and unknown internal events are excluded. */
export function conversation(thread: any): Conversation {
  return { source: 'thread', turns: (thread.turns ?? []).map((t: any) => ({ id: t.id, status: t.status, startedAt: number(t.startedAt), completedAt: number(t.completedAt), durationMs: number(t.durationMs), error: t.error?.message })), items: (thread.turns ?? []).flatMap((turn: any) => (turn.items ?? []).flatMap((item: any): ConversationItem[] => {
    const base = { id: item.id, turnId: turn.id, kind: item.type, status: item.status, phase: item.phase, durationMs: number(item.durationMs) }
    if (item.type === 'userMessage') return [{ ...base, role: 'user', text: (item.content ?? []).map((c: any) => c.text ?? '').filter(Boolean).join('\n'), images: (item.content ?? []).filter((c: any) => (c.type === 'image' && typeof c.url === 'string') || (c.type === 'localImage' && typeof c.path === 'string')).map((c: any) => c.url ?? c.path), files: (item.content ?? []).filter((c: any) => c.type === 'mention' && typeof c.path === 'string' && c.path.startsWith('/')).map((c: any) => ({ name: c.name, path: c.path })) }]
    if (item.type === 'agentMessage' || item.type === 'plan') return [{ ...base, role: 'assistant', phase: item.type === 'plan' ? 'commentary' : item.phase, text: item.text ?? '' }]
    if (item.type === 'commandExecution') return [{ ...base, role: 'tool', text: [item.command, item.aggregatedOutput].filter(Boolean).join('\n'), title: item.command, output: item.aggregatedOutput ?? '', cwd: item.cwd, exitCode: typeof item.exitCode === 'number' ? item.exitCode : undefined }]
    if (item.type === 'fileChange') return [{ ...base, role: 'tool', text: JSON.stringify(item.changes), title: '文件修改', changes: (item.changes ?? []).map((c: any) => ({ path: c.path, diff: c.diff ?? '', kind: typeof c.kind === 'string' ? c.kind : c.kind?.type })) }]
    if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') return [{ ...base, role: 'tool', title: [item.server ?? item.namespace, item.tool].filter(Boolean).join(' / '), text: JSON.stringify(item.result ?? item.contentItems ?? item.error ?? ''), output: JSON.stringify(item.result ?? item.contentItems ?? item.error ?? '', null, 2), arguments: item.arguments }]
    if (item.type === 'functionCallOutput') return [{ ...base, role: 'tool', title: item.name, text: typeof item.output === 'string' ? item.output : JSON.stringify(item.output), output: typeof item.output === 'string' ? item.output : JSON.stringify(item.output, null, 2) }]
    if (item.type === 'webSearch') return [{ ...base, role: 'tool', title: '网页搜索', text: item.query ?? '', output: JSON.stringify(item.action ?? '', null, 2) }]
    if (item.type === 'contextCompaction') return [{ ...base, role: 'tool', title: '上下文已压缩', text: '' }]
    return []
  })) }
}
