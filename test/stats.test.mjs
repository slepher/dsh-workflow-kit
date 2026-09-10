import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
test('usage details count cached input once and omit unavailable counters', async () => {
  const result = await build({entryPoints:['src/stats.tsx'],bundle:true,write:false,format:'cjs',packages:'external',platform:'node'})
  const module = {exports:{}}
  runInNewContext(result.outputFiles[0].text, {module, exports:module.exports, require: name => name === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(name)})
  const rows = Object.fromEntries(module.exports.usageRows({totalTokens:110,inputTokens:100,cachedInputTokens:80,cacheWriteInputTokens:null,outputTokens:10,reasoningOutputTokens:null}))
  assert.equal(rows['未缓存输入'],'20')
  assert.equal(rows['缓存命中'],'80%')
  assert.equal(rows['总用量'],'110')
  assert.equal(rows['推理输出'],undefined)
  assert.equal(rows['缓存写入'],undefined)
})
