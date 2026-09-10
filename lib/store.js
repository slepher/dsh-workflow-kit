import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
export class WorkflowStore {
    stateDir;
    file;
    state;
    constructor(stateDir) {
        this.stateDir = stateDir;
        if (!isAbsolute(stateDir))
            throw new Error("stateDir must be absolute");
        mkdirSync(stateDir, { recursive: true, mode: 0o700 });
        this.file = join(stateDir, "workflow.json");
        try {
            this.state = parse(readFileSync(this.file, "utf8"));
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            this.state = { workers: [], runs: [], lanes: [] };
        }
    }
    read() { return this.state; }
    save() {
        const temp = `${this.file}.${process.pid}.tmp`;
        writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
        renameSync(temp, this.file);
    }
}
function parse(text) {
    const value = JSON.parse(text);
    if (!Array.isArray(value.workers) || !Array.isArray(value.runs) || !Array.isArray(value.lanes))
        throw new Error("Invalid workflow state");
    for (const worker of value.workers) {
        if (!worker || typeof worker.id !== "string" || typeof worker.parentId !== "string" || !Array.isArray(worker.reports))
            throw new Error("Invalid workflow worker state");
        worker.output ??= {};
        worker.lastEventSequence ??= 0;
    }
    return value;
}
//# sourceMappingURL=store.js.map