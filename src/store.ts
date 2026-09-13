import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { WorkflowState } from "./types.js";

export class WorkflowStore {
  private readonly file: string;
  private state: WorkflowState;

  constructor(readonly stateDir: string) {
    if (!isAbsolute(stateDir)) throw new Error("stateDir must be absolute");
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.file = join(stateDir, "orchestration.json");
    try { this.state = parse(readFileSync(this.file, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { runs: [], lanes: [] };
    }
  }

  read(): WorkflowState { return this.state; }

  selectedProfile(parentSessionId: string, defaultProfile?: string): string | undefined {
    if (!parentSessionId) throw new Error("Native parent Session identity is required");
    if (!Object.hasOwn(this.state.selectedProfiles ?? {}, parentSessionId)) this.selectProfile(parentSessionId, defaultProfile);
    return this.state.selectedProfiles![parentSessionId] ?? undefined;
  }

  selectProfile(parentSessionId: string, profileId: string | undefined): void {
    if (!parentSessionId) throw new Error("Native parent Session identity is required");
    const next = { ...this.state, selectedProfiles: { ...this.state.selectedProfiles, [parentSessionId]: profileId ?? null } };
    this.write(next);
    this.state = next;
  }

  save(): void {
    this.write(this.state);
  }

  putNativeChild(record: import("./workers.js").NativeChildRecord): void {
    const next = { ...this.state, nativeChildren: { ...this.state.nativeChildren, [record.id]: structuredClone(record) } };
    this.write(next);
    this.state = next;
  }

  private write(state: WorkflowState): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.file);
  }
}

function parse(text: string): WorkflowState {
  const value = JSON.parse(text) as Partial<WorkflowState>;
  if (!Array.isArray(value.runs) || !Array.isArray(value.lanes)) throw new Error("Invalid workflow orchestration state");
  if (value.selectedProfiles !== undefined && (value.selectedProfiles === null || typeof value.selectedProfiles !== "object" || Array.isArray(value.selectedProfiles)
    || Object.values(value.selectedProfiles).some(id => id !== null && (typeof id !== "string" || !id)))) throw new Error("Invalid workflow profile selections");
  if (value.nativeChildren !== undefined && (value.nativeChildren === null || typeof value.nativeChildren !== "object" || Array.isArray(value.nativeChildren))) throw new Error("Invalid native child records");
  for (const [id, record] of Object.entries(value.nativeChildren ?? {})) {
    if (!record || record.id !== id || typeof record.parentSessionId !== "string" || !record.parentSessionId
      || typeof record.role !== "string" || typeof record.profile !== "string" || typeof record.execution?.model !== "string"
      || typeof record.execution.reasoningEffort !== "string" || typeof record.execution.developerInstructions !== "string"
      || typeof record.boundary?.cwd !== "string" || !Array.isArray(record.boundary.writableRoots)
      || !Array.isArray(record.dispatches) || !record.acceptance || typeof record.acceptance !== "object") throw new Error(`Invalid native child record: ${id}`);
  }
  return { runs: value.runs, lanes: value.lanes, ...(value.selectedProfiles === undefined ? {} : { selectedProfiles: value.selectedProfiles }),
    ...(value.nativeChildren === undefined ? {} : { nativeChildren: value.nativeChildren }) };
}
