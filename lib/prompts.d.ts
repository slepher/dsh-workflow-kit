/**
 * One prompt skill bundled with this plugin. Roles bind these by name; they are
 * plugin data and have nothing to do with Codex-native skills or the composer's
 * `$` catalogue.
 */
export interface PromptSkill {
    name: string;
    description: string;
    content: string;
}
/** Every bundled prompt skill, generated from `src/prompts/*.md` at build time. */
export declare const PROMPT_SKILLS: readonly PromptSkill[];
/** Resolve one bundled prompt skill by exact name; a missing name is a configuration error, not an empty prompt. */
export declare function getPromptSkill(name: string): PromptSkill;
/** Fail fast when a role references a prompt skill this package does not bundle. */
export declare function assertPromptSkills(names: readonly string[]): void;
//# sourceMappingURL=prompts.d.ts.map