import {test} from 'node:test'
import assert from 'node:assert/strict'
import {modelSettings} from '../lib/models.js'
test('model picker reads workspace Codex defaults and every catalogue page',async()=>{
 const calls=[]
 const value=await modelSettings(async(method,params)=>{calls.push({method,params});if(method==='config/read')return {config:{model:'b',model_reasoning_effort:'high'}};return params.cursor?{data:[{model:'b',displayName:'B',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null}:{data:[{model:'a',isDefault:true}],nextCursor:'next'}},'/tmp')
 assert.equal(value.model,'b');assert.equal(value.effort,'high');assert.equal(value.models.length,2);assert.equal(calls[0].params.cwd,'/tmp')
})
