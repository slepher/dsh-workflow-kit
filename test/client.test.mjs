import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import React from 'react'
import renderer, { act } from 'react-test-renderer'
const require = createRequire(import.meta.url)
const stored=new Map()
let client
runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { client = value.factory(name => name === '@deepseek-ai/dsh-client-ui-primitives' ? { MarkdownText: ({text})=>React.createElement('div',null,text), IconDatabaseOutline16:()=>null, IconClockOutline16:()=>null, IconGaugeOutline16:()=>null, useAnchoredPosition:()=>null, useAnchoredMaxHeight:()=>320, useDismissOnOutsidePointer:()=>{}, IconCopyOutline16:()=>null, IconCheckOutline16:()=>null, writeClipboard:async()=>true } : require(name)) } } }, document: { addEventListener(){}, removeEventListener(){}, createElement: () => ({ remove() {} }), head: { append() {} } }, localStorage: { getItem: k=>stored.get(k) ?? null, setItem: (k,v)=>stored.set(k,v) }, setTimeout, clearTimeout })
const worker = (id, state, extra = {}) => ({ id, name: id, state, threadId: 'thread', turnId: 'turn', usage: { total: { totalTokens: 9000000, inputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: null, reasoningOutputTokens: null }, last: { totalTokens: 100000 }, modelContextWindow: 270000 }, reports: [], approvals: [], ...extra })
test('header dock groups agent activity separately from user conversations and collapses active pills with the sidebar',async()=>{
 const slots=[]
 client.apply({effect:f=>f(),connection:{rpc:{}},sidebarRight:{},sidebarRightTabs:{register:()=>()=>{}},slots:{inject:(_,f)=>f(),register:(spec,component)=>slots.push({spec,component})}})
 assert(slots.some(s=>s.spec.name==='conversation.session.header.utilities'))
 assert(!slots.some(s=>s.spec.name==='conversation.composer.dock'))
 const rows=[worker('running','running'),worker('idle','idle'),worker('private','running',{owner:'user'})]
 let view,opened
 try{
  await act(async()=>{view=renderer.create(React.createElement(client.Dock,{sessionId:'A',call:async()=>rows,open:w=>opened=w.id}))})
  assert.equal(view.root.findAllByProps({'aria-label':'打开 Codex 对话 running'}).length,1)
  assert.equal(view.root.findAllByProps({'aria-label':'打开 Codex 对话 private'}).length,0)
  const groups=view.root.findAllByProps({className:'cw-fold'})
  await act(async()=>groups[1].props.onMouseEnter())
  assert.equal(view.root.findAllByProps({'aria-label':'打开 Codex 对话 private'}).length,1)
  assert.equal(view.root.findAllByProps({'aria-label':'Link private'}).length,1)
  assert.equal(view.root.findAllByProps({'aria-label':'Close private'}).length,1)
  assert.equal(view.root.findAllByProps({className:'cw-new'}).length,1)
  await act(async()=>view.root.findByProps({'aria-label':'打开 Codex 对话 running'}).props.onClick())
  assert.equal(opened,'running')
  await act(async()=>view.update(React.createElement(client.Dock,{sessionId:'A',call:async()=>rows,open(){},collapsed:true})))
  assert.equal(view.root.findAllByProps({'aria-label':'打开 Codex 对话 running'}).length,0)
  assert(view.root.findAllByType('button').some(b=>b.children.join('')==='活跃 1'))
 }finally{if(view)await act(async()=>view.unmount())}
})

test('sidebar displays actual user/assistant content and routes steer to selected worker', async () => {
  const calls=[]
  const call=async(session,input)=>{calls.push({session,input});if(input.action==='models')return {models:[],model:null,effort:null};if(input.action==='list')return [worker('w','running')];if(input.action==='conversation')return {source:'thread',items:[{id:'u',turnId:'turn',role:'user',text:'task text'},{id:'a',turnId:'turn',role:'assistant',text:'current answer'}]};return {}}
  let view
  try {
    await act(async()=>{view=renderer.create(React.createElement(client.ConversationPanel,{sessionId:'A',workerId:'w',call}))})
    assert.match(JSON.stringify(view.toJSON()),/task text/)
    assert.match(JSON.stringify(view.toJSON()),/current answer/)
    await act(async()=>view.root.findByType('textarea').props.onChange({target:{value:'continue'}}))
    await act(async()=>view.root.findAllByType('form').find(f=>f.props.className!=='cw-settings').props.onSubmit({preventDefault(){}}))
    assert(calls.some(c=>c.session==='A'&&c.input.workerId==='w'&&c.input.action==='steer'&&c.input.turnId==='turn'&&c.input.text==='continue'))
  } finally {if(view)await act(async()=>view.unmount())}
})

test('role label takes precedence; otherwise model prefix is removed and effort retained; second click collapses',()=>{
  const w=worker('w','running',{model:'gpt-5.6-luna',effort:'high'})
  assert.equal(client.workerLabel(w),'luna · high')
  assert.equal(client.workerLabel({...w,role:'reviewer'}),'reviewer')
  assert.equal(client.workerLabel({...w,model:'gpt-5.4-mini'}),'5.4-mini · high')
  assert.equal(client.workerLabel({...w,model:'gpt-6-astra'}),'astra · high')
  const calls=[];const sidebar={isExpanded:()=>true,toggleExpanded:()=>calls.push('close'),openTab:()=>calls.push('open')}
  client.toggleWorker(sidebar,{sessionId:'A',workerId:'w'},'A',w)
  client.toggleWorker(sidebar,{sessionId:'A',workerId:'other'},'A',w)
  client.toggleWorker(sidebar,{sessionId:'B',workerId:'w'},'A',w)
  assert.deepEqual(calls,['close','open','open'])
})

test('New keeps a blank draft, saves local defaults and creates only on first send',async()=>{
 const calls=[];let opened,view
 const call=async(session,input)=>{calls.push(input);if(input.action==='models')return {model:'gpt-a',effort:'high',models:[{model:'gpt-a',displayName:'A',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]},{model:'gpt-b',displayName:'B',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};return worker('new','idle')}
 try{
  await act(async()=>{view=renderer.create(React.createElement(client.NewConversation,{sessionId:'A',call,open:w=>{opened=w.id}}))})
  assert.equal(calls.length,1);assert.equal(calls[0].action,'models')
  assert.match(view.root.findByProps({className:'cw-model-trigger'}).props['aria-label'],/A.*High/)
  await act(async()=>view.root.findAllByProps({role:'menuitem'})[0].props.onClick())
  await act(async()=>view.root.findAllByProps({role:'menuitemradio'})[1].props.onClick())
  assert.equal(calls.length,1)
  assert.equal(JSON.parse(stored.get('codex-workers.new-defaults')).model,'gpt-b')
  assert.match(view.root.findByProps({className:'cw-model-trigger'}).props['aria-label'],/B.*Low/)
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}))
  assert.equal(calls.length,1)
  await act(async()=>view.root.findByType('textarea').props.onChange({target:{value:'hello'}}))
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}))
  assert(calls.some(c=>c.action==='create'&&c.model==='gpt-b'&&c.effort==='low'))
  assert(calls.some(c=>c.action==='append'&&c.workerId==='new'&&c.text==='hello'));assert.equal(opened,'new')
 }finally{if(view)await act(async()=>view.unmount())}
})

test('New validates saved defaults against the current Codex catalogue',async()=>{
 let view;const settings={model:'gpt-a',effort:'high',models:[{model:'gpt-a',displayName:'A',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]}]}
 try {
  stored.set('codex-workers.new-defaults',JSON.stringify({model:'gpt-a',effort:'medium'}))
  await act(async()=>{view=renderer.create(React.createElement(client.NewConversation,{sessionId:'A',call:async()=>settings,open(){}}))})
  assert.match(view.root.findByProps({className:'cw-model-trigger'}).props['aria-label'],/A.*Medium/)
  await act(async()=>view.unmount())
  stored.set('codex-workers.new-defaults',JSON.stringify({model:'removed',effort:'ultra'}))
  await act(async()=>{view=renderer.create(React.createElement(client.NewConversation,{sessionId:'A',call:async()=>settings,open(){}}))})
  assert.match(view.root.findByProps({className:'cw-model-trigger'}).props['aria-label'],/A.*High/)
 } finally {stored.clear();if(view)await act(async()=>view.unmount())}
})
test('opening a saved idle worker resumes once without sending a task',async()=>{
 const calls=[];let view
 const call=async(session,input)=>{calls.push(input);if(input.action==='list')return [worker('restored','saved',{savedState:'idle'})];if(input.action==='models')return {models:[],model:null,effort:null};if(input.action==='conversation')return {source:'thread',items:[]};return {}}
 try {
  await act(async()=>{view=renderer.create(React.createElement(client.ConversationPanel,{sessionId:'A',workerId:'restored',call}))})
  assert.equal(calls.filter(c=>c.action==='resume').length,1)
  assert(!calls.some(c=>['create','append','steer'].includes(c.action)))
 } finally {if(view)await act(async()=>view.unmount())}
})

test('compact clears the command without leaving a permanent started notice',async()=>{
 const calls=[]
 const call=async(session,input)=>{calls.push(input);if(input.action==='list')return [worker('compact-ui','idle')];if(input.action==='models')return {models:[],model:null,effort:null};if(input.action==='conversation')return {source:'thread',items:[]};return {}}
 let view
 try{
  await act(async()=>{view=renderer.create(React.createElement(client.ConversationPanel,{sessionId:'A',workerId:'compact-ui',call}))})
  await act(async()=>view.root.findByType('textarea').props.onChange({target:{value:'/compact'}}))
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}))
  assert(calls.some(c=>c.action==='compact'&&c.workerId==='compact-ui'))
  assert.equal(view.root.findByType('textarea').props.value,'')
  assert(!JSON.stringify(view.toJSON()).includes('已开始压缩'))
 }finally{if(view)await act(async()=>view.unmount())}
})

test('Resume lists importable threads, adopts the selected thread and opens the existing view', async () => {
  const calls=[], opened=[]
  const slots=[]
  const connection={rpc:{call:async(_channel,_method,{input})=>{
    calls.push(input)
    if(input.action==='sessions')return {ok:true,value:{data:[{id:'thread-old',name:'old task',cwd:'/work',updatedAt:1}],nextCursor:null}}
    if(input.action==='adopt')return {ok:true,value:worker('adopted','idle')}
    return {ok:true,value:[]}
  }}}
  client.apply({effect:f=>f(),connection,sidebarRight:{isExpanded:()=>true,openTab:(kind,options)=>opened.push({kind,options})},sidebarRightTabs:{register:()=>()=>{}},slots:{inject:(_,f)=>f(),register:(spec,component)=>{slots.push({spec,component});return()=>{}}}})
  const Body=slots.find(slot=>slot.spec.name==='sidebar.right.pane.tab').component
  let view
  try{
    await act(async()=>{view=renderer.create(React.createElement(Body,{sessionId:'A',useTabInfo:()=>({tab:{visible:true,navigation:{params:{workerId:'resume'}}},sidebar:{fullscreen:false}})}));await new Promise(resolve=>setTimeout(resolve,220))})
    assert(calls.some(input=>input.action==='sessions'))
    await act(async()=>view.root.findAllByType('strong').find(node=>node.children.join('')==='old task').parent.props.onClick())
    assert(calls.some(input=>input.action==='adopt'&&input.threadId==='thread-old'))
    assert.equal(opened.at(-1).kind,'codex-worker')
    assert.equal(opened.at(-1).options.params.workerId,'adopted')
  }finally{if(view)await act(async()=>view.unmount())}
})

test('transcript approval, acknowledgement and acceptance controls dispatch real actions', async () => {
  const calls=[]
  const row=worker('actions','running',{
    approvals:[{id:'approval-1',method:'command/approve',params:{command:'git status'}}],
    reports:[{workerId:'actions',threadId:'thread',turnId:'turn',status:'completed',result:'done',createdAt:1,acceptance:'pending'}],
  })
  const call=async(session,input)=>{
    calls.push({session,input})
    if(input.action==='list')return [row]
    if(input.action==='models')return {models:[],model:null,effort:null}
    if(input.action==='conversation')return {source:'thread',items:[]}
    return {}
  }
  let view
  try{
    await act(async()=>{view=renderer.create(React.createElement(client.ConversationPanel,{sessionId:'A',workerId:'actions',call}))})
    for(const label of ['批准本次请求','确认已读','验收通过'])await act(async()=>view.root.findAllByType('button').find(button=>button.children.join('')===label).props.onClick())
    assert(calls.some(({input})=>input.action==='approve'&&input.approvalId==='approval-1'&&input.decision==='accept'))
    assert(calls.some(({input})=>input.action==='ack'&&input.turnId==='turn'))
    assert(calls.some(({input})=>input.action==='accept'&&input.turnId==='turn'&&input.acceptance==='accepted'))
  }finally{if(view)await act(async()=>view.unmount())}
})
