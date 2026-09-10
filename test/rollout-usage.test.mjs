import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rolloutUsage } from '../lib/rollout-usage.js'

test('reads latest persisted usage for the matching rollout and ignores an unfinished row', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-workflow-rollout-'))
  const path = join(directory, 'rollout.jsonl')
  const info = n => ({
    total_token_usage: { total_tokens: n, input_tokens: n - 10, output_tokens: 10, cached_input_tokens: 40 },
    last_token_usage: { total_tokens: 50, input_tokens: 40, output_tokens: 10 },
    model_context_window: 1000,
  })
  const row = n => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: info(n) } })
  writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { id: 'external' } }) + '\n' + row(100) + '\n' + row(200) + '\n{"unfinished"')

  const usage = await rolloutUsage(path, 'external')
  assert.equal(usage.total.totalTokens, 200)
  assert.equal(usage.currentContextTokens, 50)
  assert.equal(usage.remainingContextRatio, .95)
  assert.equal(await rolloutUsage(path, 'wrong'), null)
})
