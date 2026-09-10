import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseUsage } from './types.js';
/** Restore Codex's persisted snapshot; never estimate tokens from transcript text. */
export async function rolloutUsage(path, threadId) {
    const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    let matches = false, usage = null;
    try {
        for await (const line of lines) {
            let row;
            try {
                row = JSON.parse(line);
            }
            catch {
                continue;
            } // A live rollout may end with an incomplete line.
            if (row.type === 'session_meta')
                matches = row.payload?.id === threadId;
            if (row.type !== 'event_msg' || row.payload?.type !== 'token_count' || !row.payload.info)
                continue;
            const info = row.payload.info;
            const values = (v) => ({
                totalTokens: v?.total_tokens, inputTokens: v?.input_tokens,
                cachedInputTokens: v?.cached_input_tokens, cacheWriteInputTokens: v?.cache_write_input_tokens,
                outputTokens: v?.output_tokens, reasoningOutputTokens: v?.reasoning_output_tokens,
            });
            const next = parseUsage({ total: values(info.total_token_usage), last: values(info.last_token_usage), modelContextWindow: info.model_context_window });
            if (next.total.totalTokens !== null && next.currentContextTokens !== null)
                usage = next;
        }
        return matches ? usage : null;
    }
    catch (error) {
        if (['ENOENT', 'EACCES'].includes(error.code ?? ''))
            return null;
        throw error;
    }
    finally {
        lines.close();
    }
}
//# sourceMappingURL=rollout-usage.js.map