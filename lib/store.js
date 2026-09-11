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
        this.file = join(stateDir, "orchestration.json");
        try {
            this.state = parse(readFileSync(this.file, "utf8"));
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            this.state = { runs: [], lanes: [] };
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
    if (!Array.isArray(value.runs) || !Array.isArray(value.lanes))
        throw new Error("Invalid workflow orchestration state");
    return { runs: value.runs, lanes: value.lanes };
}
//# sourceMappingURL=store.js.map