export async function modelSettings(query, cwd) {
    const { config } = await query('config/read', { includeLayers: false, cwd });
    const models = [];
    let cursor = null;
    do {
        const page = await query('model/list', { cursor, limit: 100 });
        models.push(...page.data);
        cursor = page.nextCursor;
    } while (cursor);
    const model = config.model ?? models.find(m => m.isDefault)?.model ?? null;
    return { models: models.map(({ model, displayName, supportedReasoningEfforts, defaultReasoningEffort }) => ({ model, displayName, supportedReasoningEfforts, defaultReasoningEffort })),
        model, effort: config.model_reasoning_effort ?? models.find(m => m.model === model)?.defaultReasoningEffort ?? null };
}
//# sourceMappingURL=models.js.map