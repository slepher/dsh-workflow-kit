import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listSkills, resolveSkills } from '../lib/skills.js'

test('skills catalogue uses cwd, excludes disabled entries, resolves exact names and rejects forged paths', async () => {
  const skill = { name: 'demo', path: '/skills/demo/SKILL.md', description: 'test', enabled: true }
  const list = await listSkills(async (method, params) => {
    assert.equal(method, 'skills/list')
    assert.deepEqual(params.cwds, ['/work'])
    return { data: [{ cwd: '/work', skills: [skill, { ...skill, name: 'disabled', enabled: false }], errors: [] }] }
  }, '/work')
  assert.equal(list.length, 1)
  assert.equal(resolveSkills('Use $demo now', list)[0].path, skill.path)
  assert.equal(resolveSkills('Use $demo-more', list).length, 0)
  assert.throws(() => resolveSkills('$demo', list, [{ ...skill, path: '/forged' }]), /unavailable/)
  assert.throws(() => resolveSkills('$demo', [...list, { ...skill, path: '/other' }]), /ambiguous/)
})
