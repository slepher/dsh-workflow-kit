import { PROMPTS } from './generated/prompts.js';
function describe(name, content) {
    const heading = /^#\s+(.+)$/m.exec(content);
    return heading ? heading[1].trim() : name;
}
/** Every bundled prompt skill, generated from `src/prompts/*.md` at build time. */
export const PROMPT_SKILLS = Object.entries(PROMPTS)
    .map(([name, content]) => ({ name, description: describe(name, content), content }));
const catalog = new Map(PROMPT_SKILLS.map(skill => [skill.name, skill]));
/** Resolve one bundled prompt skill by exact name; a missing name is a configuration error, not an empty prompt. */
export function getPromptSkill(name) {
    const skill = catalog.get(name);
    if (!skill)
        throw new Error(`Unknown plugin prompt skill: ${name}`);
    return skill;
}
/** Fail fast when a role references a prompt skill this package does not bundle. */
export function assertPromptSkills(names) {
    for (const name of names)
        getPromptSkill(name);
}
//# sourceMappingURL=prompts.js.map