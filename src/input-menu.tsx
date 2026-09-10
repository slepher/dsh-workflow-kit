import { useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useId, useState, useRef } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import type { Action, Skill } from './types.js'
export const commands = [
  ['model','选择模型和推理等级'], ['skills','打开技能列表'], ['status','查看当前会话状态'],
  ['new','打开空白对话'], ['compact','压缩当前对话上下文'], ['review','审查未提交的改动'], ['copy','复制最近的回答'],
] as const
export function useInputMenu({text, setText, input, sessionId, workerId, call, command}: {
  text: string; setText:(text:string)=>void; input:RefObject<HTMLTextAreaElement>; sessionId:string; workerId?:string;
  call:(sessionId:string,input:Action)=>Promise<unknown>; command:(name:string)=>Promise<void>
}) {
  const [catalog,setCatalog] = useState<Skill[]>([]), [selected,setSelected] = useState<Skill[]>([])
  const [error,setError] = useState(''), [loading,setLoading] = useState(false), [cursor,setCursor] = useState(0), [closed,setClosed] = useState(false)
  const [caret,setCaret] = useState(text.length), [revision,reload] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const maxHeight = useAnchoredMaxHeight(list,320,text)
  const id = useId(), slash = /^\/([\w-]*)$/.exec(text), skill = /(?:^|\s)\$([\w:-]*)$/.exec(text.slice(0,caret))
  const kind = slash ? 'command' : skill ? 'skill' : null, query = (slash?.[1] ?? skill?.[1] ?? '').toLowerCase()
  useEffect(() => { setClosed(false);setCursor(0) }, [text,caret])
  useEffect(() => {
    if (kind !== 'skill') return
    let disposed = false
    setLoading(true);setError('')
    void call(sessionId,{action:'skills',workerId}).then(value=>{if (!disposed) setCatalog(value as Skill[])}).catch(e=>{if (!disposed) setError(String(e))}).finally(()=>{if (!disposed) setLoading(false)})
    return ()=>{disposed=true}
  }, [kind,sessionId,workerId,call,revision])
  useEffect(() => {
    if (!kind || closed) return
    const dismiss = (e:PointerEvent) => { if (!input.current?.closest('.cw-composer-card')?.contains(e.target as Node)) setClosed(true) }
    document.addEventListener('pointerdown',dismiss)
    return ()=>document.removeEventListener('pointerdown',dismiss)
  }, [kind,closed,input])
  const options = kind === 'command' ? commands.filter(([name])=>name.startsWith(query)).map(([name,description])=>({name,description,path:''})) : catalog.filter(s=>`${s.name} ${s.description}`.toLowerCase().includes(query))
  const open = !!kind && !closed
  const choose = async (index:number) => {
    const option=options[index]; if (!option) return
    if (kind === 'command') { setClosed(true); await command(option.name); return }
    const start = caret - (skill?.[1].length ?? 0) - 1
    const prefix=text.slice(0,start)+`$${option.name} `
    setText(prefix+text.slice(caret));setSelected(previous=>[...previous.filter(s=>s.path!==option.path),option]);setClosed(true)
    requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(prefix.length,prefix.length)})
  }
  const onKeyDown = (e:KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || e.nativeEvent.isComposing || e.keyCode === 229) return false
    if (e.key === 'Escape') { e.preventDefault();setClosed(true);return true }
    if (options.length && ['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key) && !e.shiftKey) {
      e.preventDefault()
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setCursor(i=>(i+(e.key==='ArrowDown'?1:options.length-1))%options.length)
      else void choose(cursor)
      return true
    }
    return false
  }
  useEffect(()=>{if(open) document.getElementById?.(`${id}-${cursor}`)?.scrollIntoView({block:'nearest'})},[cursor,open,id])
  return {onKeyDown, setCaret, selected: selected.filter(s=>[...text.matchAll(/(?:^|\s)\$([\w:-]+)(?=\s|$|[.,!?，。！？])/g)].some(m=>m[1]===s.name)), clear:()=>setSelected([]),
    aria: {'aria-autocomplete':'list' as const, 'aria-expanded':open, 'aria-controls':open?id:undefined,'aria-activedescendant':open&&options.length?`${id}-${cursor}`:undefined},
    menu:open && <div ref={list} style={{maxHeight}} className="cw-input-menu" onMouseDown={e=>e.preventDefault()}><div className="cw-input-menu-title">{kind==='command'?'Codex 指令':'Codex Skills'}</div><div role="listbox" id={id} aria-label={kind==='command'?'Codex 指令':'Codex Skills'}>{options.map((option,index)=><button type="button" className="cw-input-option" role="option" aria-selected={cursor===index} id={`${id}-${index}`} key={option.path||option.name} onMouseMove={()=>setCursor(index)} onClick={()=>void choose(index)}><span className="cw-input-name">{kind==='command'?'/':'$'}{option.name}</span><span className="cw-input-description" title={option.description+(kind==='skill'?' · '+option.path:'')}>{option.description}{kind==='skill'&&catalog.filter(s=>s.name===option.name).length>1&&` · ${option.path}`}</span></button>)}</div>{kind==='skill'&&loading&&<p role="status">正在读取 Skills…</p>}{kind==='skill'&&error&&<p role="alert">{error}<button type="button" onClick={()=>reload(n=>n+1)}>重试</button></p>}{(kind==='command'||!loading&&!error)&&!options.length&&<p>没有匹配项</p>}</div>}
}
