import {test} from 'node:test'
import assert from 'node:assert/strict'
import {conversation} from '../lib/conversation.js'
test('thread history renders public messages and tools, excluding hidden reasoning',()=>{
  const result=conversation({turns:[{id:'t',items:[{id:'u',type:'userMessage',content:[{type:'text',text:'task'}]},{id:'r',type:'reasoning',text:'private'},{id:'a',type:'agentMessage',text:'answer'},{id:'c',type:'commandExecution',command:'pwd',aggregatedOutput:'/tmp'}]}]})
  assert.deepEqual(result.items.map(i=>[i.role,i.text]),[['user','task'],['assistant','answer'],['tool','pwd\n/tmp']])
})
test('projects tool metadata, files, compaction and actual turn timing',()=>{
 const result=conversation({turns:[{id:'t',status:'completed',startedAt:100,completedAt:103,durationMs:3000,items:[{id:'c',type:'commandExecution',command:'pwd',status:'failed',aggregatedOutput:'error',exitCode:1,durationMs:40,cwd:'/tmp'},{id:'f',type:'fileChange',status:'completed',changes:[{path:'/tmp/a',kind:{type:'update'},diff:'-old\n+new'}]},{id:'x',type:'contextCompaction'}]}]})
 assert.equal(result.turns[0].durationMs,3000)
 assert.equal(result.items[0].exitCode,1);assert.equal(result.items[0].status,'failed')
 assert.equal(result.items[1].changes[0].diff,'-old\n+new');assert.equal(result.items[2].kind,'contextCompaction')
})
