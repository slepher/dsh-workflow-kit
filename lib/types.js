export function parseUsage(value) {
    const count = (entry) => typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0 ? entry : null;
    const breakdown = (entry) => ({
        totalTokens: count(entry?.totalTokens),
        inputTokens: count(entry?.inputTokens),
        cachedInputTokens: count(entry?.cachedInputTokens),
        cacheWriteInputTokens: count(entry?.cacheWriteInputTokens),
        outputTokens: count(entry?.outputTokens),
        reasoningOutputTokens: count(entry?.reasoningOutputTokens),
    });
    const currentContextTokens = count(value?.last?.totalTokens);
    const modelContextWindow = count(value?.modelContextWindow);
    return {
        total: breakdown(value?.total),
        last: breakdown(value?.last),
        modelContextWindow,
        currentContextTokens,
        remainingContextRatio: currentContextTokens !== null && modelContextWindow !== null && modelContextWindow > 0
            ? Math.max(0, 1 - currentContextTokens / modelContextWindow)
            : null,
    };
}
export function compactionTurnIds(history) {
    const grouped = new Map();
    for (const item of history?.items ?? [])
        grouped.set(item.turnId, [...(grouped.get(item.turnId) ?? []), item]);
    return new Set([...grouped]
        .filter(([, items]) => items.length > 0 && items.every(item => item.kind === "contextCompaction"))
        .map(([id]) => id));
}
//# sourceMappingURL=types.js.map