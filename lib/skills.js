export async function listSkills(query, cwd) {
    const result = await query('skills/list', { cwds: [cwd], forceReload: true });
    const entries = result.data.filter((entry) => entry.cwd === cwd);
    const errors = entries.flatMap((entry) => entry.errors ?? []);
    if (errors.length)
        throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    return entries.flatMap((entry) => entry.skills).filter((skill) => skill.enabled).map(({ name, path, description }) => ({ name, path, description }));
}
export function resolveSkills(text, catalog, selected = []) {
    if (!Array.isArray(selected))
        throw new Error('Invalid skill selection');
    const result = selected.map(skill => {
        const match = catalog.find(s => s.name === skill?.name && s.path === skill?.path);
        if (!match)
            throw new Error('Selected skill is unavailable; select it again');
        return match;
    });
    for (const name of new Set([...text.matchAll(/(?:^|\s)\$([\w:-]+)(?=\s|$|[.,!?，。！？])/g)].map(m => m[1]))) {
        if (result.some(s => s.name === name))
            continue;
        const matches = catalog.filter(s => s.name === name);
        if (matches.length > 1)
            throw new Error(`Skill $${name} is ambiguous; select it from the menu`);
        if (matches.length === 1)
            result.push(matches[0]);
    }
    return [...new Map(result.map(s => [s.path, s])).values()];
}
//# sourceMappingURL=skills.js.map