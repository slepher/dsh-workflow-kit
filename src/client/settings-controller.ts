/**
 * Settings-page controller for `dsh-workflow-kit`. It joins two sources the
 * page cannot read on its own: the installed-file catalog plus the merged user
 * layer, which the Host answers on the plugin's own channel, and the writable
 * settings scope, which owns persistence and revision fencing. Every edit is a
 * path mutation, so a section this browser never saw (a secret, a future field)
 * survives a write untouched.
 */
import type { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore, type SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { SettingsPathOpView } from "@deepseek-ai/dsh-api-remotes/client";
import type { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ConfigView, WorkflowSettingsSection } from "../profile-types.js";
import { DEFAULT_CODING_STRATEGY, DEFAULT_INTEGRATE_STRATEGY, type CodingStrategy } from "../constants.js";
import { loadModelOptions, type ModelGroup } from "./model-catalog.js";
import type { WorkflowRpc } from "./rpc.js";

/** Everything the settings page renders. */
export interface WorkflowSettingsState {
  /** Settings sync state; `unavailable` disables every editor. */
  status: "loading" | "ready" | "unavailable" | "error";
  /** Whether the Host document accepts writes. */
  writable: boolean;
  /** Whether a write is in flight. */
  saving: boolean;
  /** Last read or write failure, already a display string. */
  error: string | null;
  /** Effective configurations: shipped files merged with the stored user layer. */
  configs: readonly ConfigView[];
  /** Effective role ids in display order. */
  roleNames: readonly string[];
  /** Configuration a new Session selects when it records none. */
  defaultConfig: string | null;
  /** Stored coding default; a Session may override it in the composer. */
  codingStrategy: CodingStrategy;
  /** Stored integrate default; integration work uses it directly. */
  integrateStrategy: CodingStrategy;
  /** Adapter-advertised provider groups the role editors offer. */
  groups: readonly ModelGroup[];
  /** Model catalog lifecycle. */
  catalog: "idle" | "loading" | "ready" | "error";
  /** Why the adapter catalog read failed, when it did. */
  catalogError: string | null;
  /** Whether any provider failed to load in the last catalog read. */
  catalogPartial: boolean;
}

/** Which stored strategy one write edits. */
export type StrategyKind = "coding" | "integrate";

/** One role's stored override value. */
export type RoleDraft = { provider: string; model: string; reasoningEffort: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owner of the settings page's snapshot store and every write it performs. */
export class WorkflowSettingsController {
  /** Bare observable the renderer binds as `useWorkflowSettings`. */
  readonly store: SnapshotStore<WorkflowSettingsState> = createSnapshotStore<WorkflowSettingsState>({
    status: "loading", writable: false, saving: false, error: null,
    configs: [], roleNames: [], defaultConfig: null,
    codingStrategy: DEFAULT_CODING_STRATEGY, integrateStrategy: DEFAULT_INTEGRATE_STRATEGY,
    groups: [], catalog: "idle", catalogError: null, catalogPartial: false,
  });

  private state: WorkflowSettingsState;
  private catalogRequested = false;
  private readonly unsubscribe: () => void;

  /**
   * @param ctx - client context carrying the remote namespace.
   * @param scope - this namespace's writable settings scope.
   * @param rpc - the plugin's own channel, which owns the merged read.
   */
  constructor(
    private readonly ctx: Context,
    private readonly scope: SettingsScope<WorkflowSettingsSection>,
    private readonly rpc: WorkflowRpc,
  ) {
    this.state = this.store.getSnapshot();
    this.unsubscribe = scope.subscribe(() => { void this.refresh(); });
    void this.refresh();
  }

  /** Stop observing the settings scope. */
  dispose(): void {
    this.unsubscribe();
  }

  /**
   * Re-read the merged catalog and the model routes, then publish.
   * @returns settlement after the published state.
   */
  async refresh(): Promise<void> {
    const snapshot = this.scope.getSnapshot();
    if (snapshot.status === "unavailable") {
      this.publish({ status: "unavailable", writable: false, saving: false });
      return;
    }
    // A failed read leaves the request open so the next refresh retries it.
    if (!this.catalogRequested) {
      if (this.state.catalog === "idle") this.publish({ catalog: "loading" });
      void loadModelOptions(this.ctx).then(
        value => {
          this.catalogRequested = true;
          this.publish({ catalog: "ready", catalogError: null, groups: value.groups, catalogPartial: value.partial });
        },
        (error: unknown) => { this.publish({ catalog: "error", catalogError: messageOf(error) }); },
      );
    }
    try {
      const catalog = await this.rpc.configurations();
      this.publish({
        status: "ready", writable: snapshot.writable, error: null,
        configs: catalog.configs, roleNames: catalog.roleNames, defaultConfig: catalog.defaultConfig,
        codingStrategy: catalog.strategies.coding, integrateStrategy: catalog.strategies.integrate,
      });
    } catch (error) {
      this.publish({ status: "error", writable: snapshot.writable, error: messageOf(error) });
    }
  }

  /**
   * Store one strategy default. Coding and integrate are written to separate
   * paths, so neither write can overwrite the other.
   * @param kind - which strategy default to store.
   * @param value - the selected strategy.
   * @returns settlement after the write and its recovery read.
   */
  setStrategy(kind: StrategyKind, value: CodingStrategy): Promise<void> {
    return this.mutate([{ op: "set", path: [kind === "coding" ? "codingStrategy" : "integrateStrategy"], value }]);
  }

  /**
   * Store one role's provider, model, and effort for one configuration.
   * @param configId - configuration the role belongs to.
   * @param role - role id.
   * @param value - the selected route.
   * @returns settlement after the write and its recovery read.
   */
  setRole(configId: string, role: string, value: RoleDraft): Promise<void> {
    return this.mutate([{ op: "set", path: ["configs", configId, "roles", role], value: { ...value } }]);
  }

  /**
   * Materialize one configuration into a new user configuration.
   * @param sourceId - configuration to copy.
   * @param newId - id for the copy.
   * @returns settlement after the write and its recovery read.
   */
  copyConfig(sourceId: string, newId: string): Promise<void> {
    const source = this.state.configs.find(config => config.id === sourceId);
    if (source === undefined) return Promise.reject(new Error(`Unknown configuration: ${sourceId}`));
    return this.mutate([{ op: "set", path: ["configs", newId], value: { roles: materialize(source) } }]);
  }

  /**
   * Move one user configuration to a new id.
   * @param oldId - current id.
   * @param newId - replacement id.
   * @returns settlement after the write and its recovery read.
   */
  renameConfig(oldId: string, newId: string): Promise<void> {
    const source = this.state.configs.find(config => config.id === oldId);
    if (source === undefined) return Promise.reject(new Error(`Unknown configuration: ${oldId}`));
    return this.mutate([
      { op: "set", path: ["configs", newId], value: { roles: materialize(source) } },
      { op: "unset", path: ["configs", oldId] },
    ]);
  }

  /**
   * Drop every user override for one configuration; a built-in reappears unchanged.
   * @param configId - configuration to reset.
   * @returns settlement after the write and its recovery read.
   */
  resetConfig(configId: string): Promise<void> {
    return this.mutate([{ op: "unset", path: ["configs", configId] }]);
  }

  /**
   * Select the configuration a new Session records when it has none.
   * @param configId - configuration id.
   * @returns settlement after the write and its recovery read.
   */
  setDefault(configId: string): Promise<void> {
    return this.mutate([{ op: "set", path: ["defaultConfig"], value: configId }]);
  }

  private async mutate(ops: readonly SettingsPathOpView[]): Promise<void> {
    this.publish({ saving: true, error: null });
    try {
      await this.scope.mutate(ops);
    } catch (error) {
      this.publish({ saving: false, error: messageOf(error) });
      throw error;
    }
    await this.refresh();
    this.publish({ saving: false });
  }

  private publish(patch: Partial<WorkflowSettingsState>): void {
    this.state = { ...this.state, ...patch };
    this.store.set(this.state);
  }
}

/** Freeze one configuration's effective roles into a stored user section. */
function materialize(config: ConfigView): Record<string, RoleDraft> {
  return Object.fromEntries(Object.entries(config.roles).map(([name, row]) => [name, {
    provider: row.provider, model: row.model, reasoningEffort: row.reasoningEffort,
  }]));
}
