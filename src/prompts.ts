import { PROMPTS } from './generated/prompts.js'

/**
 * One prompt skill bundled with this plugin. Roles bind these by name; they are
 * plugin data and have nothing to do with Codex-native skills or the composer's
 * `$` catalogue.
 */
export interface PromptSkill { name: string; description: string; content: string }

function describe(name: string, content: string): string {
  const heading = /^#\s+(.+)$/m.exec(content)
  return heading ? heading[1].trim() : name
}

/** Every bundled prompt skill, generated from `src/prompts/*.md` at build time. */
export const PROMPT_SKILLS: readonly PromptSkill[] = Object.entries(PROMPTS)
  .map(([name, content]) => ({ name, description: describe(name, content), content }))

const catalog = new Map(PROMPT_SKILLS.map(skill => [skill.name, skill]))

/** Resolve one bundled prompt skill by exact name; a missing name is a configuration error, not an empty prompt. */
export function getPromptSkill(name: string): PromptSkill {
  const skill = catalog.get(name)
  if (!skill) throw new Error(`Unknown plugin prompt skill: ${name}`)
  return skill
}

/** Fail fast when a role references a prompt skill this package does not bundle. */
export function assertPromptSkills(names: readonly string[]): void {
  for (const name of names) getPromptSkill(name)
}
