import { PROMPTS } from './generated/prompts.js'

/** Resolve one bundled prompt skill by exact name; a missing name is a configuration error, not an empty prompt. */
export function getPromptSkill(name: string): string {
  if (!Object.hasOwn(PROMPTS, name)) throw new Error(`Unknown plugin prompt skill: ${name}`)
  return PROMPTS[name]!
}

/** Fail fast when a role references a prompt skill this package does not bundle. */
export function assertPromptSkills(names: readonly string[]): void {
  for (const name of names) getPromptSkill(name)
}
