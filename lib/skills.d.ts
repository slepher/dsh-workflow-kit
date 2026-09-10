import type { Skill } from './types.js';
export declare function listSkills(query: (method: string, params: unknown) => Promise<any>, cwd: string): Promise<Skill[]>;
export declare function resolveSkills(text: string, catalog: Skill[], selected?: Skill[]): Skill[];
//# sourceMappingURL=skills.d.ts.map