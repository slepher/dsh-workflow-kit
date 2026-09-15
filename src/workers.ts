import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-subagent";
import * as subagentInternal from "@deepseek-ai/dsh-subagent/internal";
import type { NativeExecution, NativeExecutionReport } from "dsh-codex-app-provider";
import type { WorkflowStore } from "./store.js";
import type { WorkflowConfiguration, RoleExecution, RoleInput, CaptureOptions } from "./configuration.js";
import type { Boundary, ChildAgentOptions, ThreadHandoffService } from "./types.js";
import { CONFIG_KEYS, CODING_WORKER } from "./roles.js";
import { bindCodingStrategy, snapshotProfile, tierConfigKey, type CodingPhase, type CodingStrategy, type EffectiveStrategy, type StrategyBinding, type Tier } from "./strategy.js";
import { handoffPrompt, parseControlSignal, type ControlSignal, type HandoffSignal } from "./control.js";

const { queueHostSubagentPrompt, steerHostSubagentPrompt } = subagentInternal;

/**
 * Native execution facts this Host reads. The confirmed model/effort and the
 * pending target describe a configuration switch in flight; a package set that
 * predates the field simply reports no pending target.
 */
type NativeFacts = NativeExecution & { pending?: { model?: string; reasoningEffort?: string } };

/** The provider whose native execution the `codexExecution` reader projects. */
const NATIVE_EXECUTION_PROVIDER = "codex";

/** One model-visible turn the DSH session itself recorded, for a non-native provider. */
interface SessionTurn {
  turnId: string;
  status: "completed" | "failed" | "interrupted";
  result: string;
  /** Session producing the turn; the child owns it, so it identifies the execution. */
  threadId: string;
  /** Epoch milliseconds of the turn's closing event. */
  createdAt: number;
}

export type ReportAcceptance = "pending" | "accepted" | "changes-requested";

/**
 * One turn's token accounting as the native provider reported it. A field is
 * `null` when the provider did not report it, which stays distinct from a
 * reported zero.
 */
export interface ReportUsage {
  totalTokens: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
}

export type Report = NativeExecutionReport & { workerId: string; acceptance: ReportAcceptance; acknowledgedAt?: number;
  /** Usage the provider attributed to this turn; absent when it reported none. */
  usage?: ReportUsage };

/** The strategy an execution was dispatched under, kept for its later phases. */
export interface BoundStrategy {
  requested: CodingStrategy;
  effective: EffectiveStrategy;
  tier: Tier;
  phase: CodingPhase;
}

/** One execution capture: the execution role plus the Profile configuration its bound strategy chose. */
export interface Capture {
  role: string;
  profile: string;
  execution: RoleExecution;
  strategy?: BoundStrategy;
  coding?: { def: RoleInput; sup: RoleInput };
}

/**
 * One bounded consultation the Host runs for a worker that asked for expert
 * judgment. The expert child uses the sup configuration and cannot write the
 * main workspace; its conclusion returns to the requesting worker, which still
 * implements and verifies the result.
 */
export interface ConsultationRequest {
  /** Worker whose completed turn asked the question. */
  workerId: string;
  /** Profile configuration snapshot the requesting worker is bound to. */
  profile: string;
  coding: { def: RoleInput; sup: RoleInput };
  /** Workspace the expert may read but not modify. */
  cwd: string;
  artifacts: string;
  results: string;
  network: Boundary["network"];
  /** The bounded consultation prompt. */
  prompt: string;
  /** Idempotency key for the expert's first prompt. */
  startKey: string;
}

/**
 * One recorded handover from an opening execution to a successor child.
 *
 * The source keeps its identity, history and reports but cannot continue; the
 * successor owns the assignment. In the Codex-to-Codex route the successor also
 * owns the original native thread, which is why the thread identity is recorded
 * here for audit and reconciliation.
 */
export interface HandoffRecord {
  /** Host request identity; a retry completes the same handover. */
  requestId: string;
  /** Opening execution that requested the handoff. */
  fromWorker: string;
  /** Completed turn whose control report requested the handoff. */
  sourceTurnId: string;
  /** Successor child identity, fixed before any side effect. */
  toWorker: string;
  /** Tier the successor continues on. */
  targetTier: Tier;
  /** Target model configuration, captured from the bound Profile snapshot. */
  targetConfig: RoleInput;
  /** The continuation prompt bound to the switch, kept for audit. */
  prompt: string;
  /** How far this handover has progressed. */
  status: "reserved" | "bound" | "started" | "confirmed";
  /** Native message id the continuation was admitted as. */
  messageId?: string;
  /** First turn observed after the switch, once the successor reports one. */
  targetTurnId?: string;
  /** Native thread the successor continues; the source's original thread. */
  threadId?: string;
  at: number;
}

export interface NativeChildRecord {
  id: string;
  parentSessionId: string;
  name: string;
  role: string;
  profile: string;
  execution: RoleExecution;
  boundary: Boundary;
  /** Coding/integrate strategy binding; absent on records dispatched before strategies existed. */
  strategy?: BoundStrategy;
  /** Sup/def Profile snapshot captured at dispatch; later Profile or setting edits never rewrite it. */
  coding?: { def: RoleInput; sup: RoleInput };
  /** The one handoff this execution performed, if its opening phase requested one. */
  handoff?: HandoffRecord;
  /** The handover this child was created to continue, when it is a successor. */
  handoffFrom?: { fromWorker: string; requestId: string };
  closed?: boolean;
  dispatches: { key: string; text: string; phase: "pending" | "accepted"; previousTurnId?: string; messageId?: string }[];
  acceptance: Record<string, { value: ReportAcceptance; acknowledgedAt?: number }>;
}
export interface WorkerProjection {
  id: string;
  parentSessionId: string;
  name: string;
  role: string;
  profile: string;
  cwd: string;
  model: string;
  effort: string;
  threadId?: string;
  turnId?: string;
  strategy?: BoundStrategy;
  /** Authorized route target the native execution has not confirmed yet. */
  pending?: { model?: string; reasoningEffort?: string };
  /** The handover this execution performed, if its opening phase requested one. */
  handoff?: HandoffRecord;
  state: "idle" | "running" | "waiting-approval" | "interrupt-requested" | "unknown";
  reports: readonly Report[];
}

/** The outcome of asking the Host to settle one execution's control report. */
export interface ControlOutcome {
  /** Whether this call performed the action; `false` means the report carried no such signal. */
  accepted: boolean;
  /** Why the control report was not acted on, when the phase authorized one. */
  reason?: string;
  signal?: ControlSignal;
  handoff?: HandoffRecord;
}

/** Workflow owns authorization and acceptance; native children and Codex own execution facts. */
/**
 * The opening prompt of one managed child.
 *
 * The workflow's role and phase instructions are its own content, so they open
 * the child's own conversation as prompt text. An empty composition (a role
 * with no prompt skills) contributes nothing rather than an empty block.
 * @param instructions - the role instructions captured for this dispatch.
 * @param text - the task text this dispatch delivers.
 * @returns the model-visible prompt blocks, oldest first.
 */
function openingPrompt(instructions: string, text: string): { type: "text"; text: string }[] {
  return instructions.trim() === ""
    ? [{ type: "text", text }]
    : [{ type: "text", text: instructions }, { type: "text", text }];
}

/**
 * Fold one session's events into its closed turns.
 * @param events - the session log, oldest first.
 * @param sessionId - the session the log belongs to, used as the turn's thread identity.
 * @returns one entry per turn that ended, oldest first.
 */
function turnsOf(events: readonly unknown[], sessionId: string): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let turn: number | undefined;
  let text = "";
  let interrupted = false;
  for (const raw of events as readonly { type: string; time: number; data: Record<string, unknown> }[]) {
    if (raw.type === "turn/start") { turn = raw.data.turn as number; text = ""; interrupted = false; continue }
    if (turn === undefined) continue;
    if (raw.type === "assistant/message" && raw.data.turn === turn) {
      const message = raw.data.message as { content?: readonly { type: string; text?: string }[] } | undefined;
      text = (message?.content ?? []).flatMap(block => block.type === "text" ? [block.text ?? ""] : []).join("\n");
      if (raw.data.interrupted === true) interrupted = true;
      continue;
    }
    if (raw.type !== "turn/end" || raw.data.turn !== turn) continue;
    const reason = raw.data.reason as { kind?: string } | undefined;
    turns.push({ turnId: `dsh-${turn}`, status: reason?.kind === "error" ? "failed" : interrupted || reason?.kind === "aborted" ? "interrupted" : "completed",
      result: text, threadId: sessionId, createdAt: raw.time });
    turn = undefined;
  }
  return turns;
}

export class WorkflowWorkers {
  private readonly request = new AsyncLocalStorage<{ parent: Agent; session: Agent["session"]; signal: AbortSignal }>();

  constructor(readonly ctx: Context, readonly store: WorkflowStore, readonly configuration: WorkflowConfiguration,
    readonly defaultProfile?: () => string | undefined, readonly workflowSkillDir?: string, readonly implementationStandardDir?: string) {}

  run<T>(parent: Agent, signal: AbortSignal, operation: () => T | Promise<T>): Promise<T> {
    return Promise.resolve(this.request.run({ parent, session: parent.session, signal }, () => { this.assertIdentity(); return operation(); }));
  }

  assertIdentity(): void {
    const value = this.context();
    if (this.ctx.agents.get(value.parent.id) !== value.parent || this.ctx.sessions.get(value.session.id) !== value.session
      || value.parent.session !== value.session) throw new Error("Parent agent identity changed");
  }

  /** The Profile this Session currently selects; the stored default applies until a Session records one. */
  selectedProfileId(): string {
    this.assertIdentity();
    const profile = this.store.selectedProfile(String(this.context().session.id), this.defaultProfile?.());
    if (profile === undefined) throw new Error("No workflow profile selected");
    return profile;
  }

  /** The coding preference this Session dispatches under, plus the stored default behind it. */
  codingStrategy(): { requested: CodingStrategy; preference: CodingStrategy | undefined } {
    this.assertIdentity();
    const preference = this.store.strategyPreference(String(this.context().session.id)) as CodingStrategy | undefined;
    return { requested: preference ?? this.configuration.strategies().coding, preference };
  }

  captureRole(role: string, requiredKeys: readonly string[] = [], options: CaptureOptions = {}): Capture {
    this.assertIdentity();
    const profile = this.selectedProfileId();
    return { role, profile, execution: this.configuration.capture(profile, role, requiredKeys, options) };
  }

  /**
   * Capture one unified `coding_worker` execution for this Session.
   * @param phase - the phase the Host binds for this execution.
   * @returns the capture, including the strategy binding and Profile snapshot.
   */
  captureCoding(phase: CodingPhase = "main"): Capture {
    const { requested } = this.codingStrategy();
    return this.codingCapture(this.selectedProfileId(), requested, phase);
  }

  /**
   * Capture one coding execution against an explicit Profile and strategy.
   * Integration phases use this instead of the Session's coding preference.
   * @param profile - bound Profile id.
   * @param requested - bound strategy.
   * @param phase - bound phase.
   * @returns the capture.
   */
  codingCapture(profile: string, requested: CodingStrategy, phase: CodingPhase = "main"): Capture {
    const binding = bindCodingStrategy(this.configuration.profile(profile), requested, phase);
    return {
      role: CODING_WORKER,
      profile,
      execution: this.configuration.capture(profile, CODING_WORKER, CONFIG_KEYS, { configKey: tierConfigKey(binding.tier), skills: binding.prompts }),
      strategy: boundStrategy(binding),
      coding: this.configuration.codingSnapshot(profile),
    };
  }

  /**
   * Capture one non-coding role under a bound strategy tier. Integration review
   * and repair keep their own role and permissions while the integrate strategy
   * chooses the model configuration.
   * @param role - execution role owning the responsibility.
   * @param profile - bound Profile id.
   * @param binding - bound strategy.
   * @returns the capture.
   */
  captureBound(role: string, profile: string, binding: StrategyBinding): Capture {
    return {
      role,
      profile,
      execution: this.configuration.capture(profile, role, CONFIG_KEYS, { configKey: tierConfigKey(binding.tier), skills: binding.prompts }),
      strategy: boundStrategy(binding),
      coding: this.configuration.codingSnapshot(profile),
    };
  }

  /**
   * Capture one execution from a bound Profile snapshot instead of the live
   * catalog. Bound integrations and later execution phases keep the model
   * configuration recorded when they were bound.
   * @param role - execution role owning the responsibility.
   * @param profile - Profile id the snapshot came from, kept for the record.
   * @param snapshot - sup/def configuration snapshot.
   * @param strategy - the binding this phase runs under.
   * @param skills - phase prompt skills appended after the role's own.
   * @returns the capture.
   */
  captureSnapshot(role: string, profile: string, snapshot: { def: RoleInput; sup: RoleInput }, strategy: BoundStrategy, skills: readonly string[] = []): Capture {
    return {
      role,
      profile,
      execution: this.configuration.captureSnapshot(role, snapshot, strategy.tier, skills),
      strategy: structuredClone(strategy),
      coding: structuredClone(snapshot),
    };
  }

  selectedRoles() {
    this.assertIdentity();
    const selected = this.store.selectedProfile(String(this.context().session.id), this.defaultProfile?.());
    if (selected === undefined) throw new Error("No workflow profile selected");
    const profile = this.configuration.view().configs.find(config => config.id === selected);
    if (profile === undefined) throw new Error(`Selected workflow profile is unavailable: ${selected}`);
    return profile.roles;
  }

  async create(parentId: string, input: Capture & { id?: string; name: string; cwd: string; managed?: boolean; boundary: Boundary }): Promise<WorkerProjection> {
    this.parent(parentId); this.managed(input.managed);
    if (!input.id || input.boundary.cwd !== input.cwd) throw new Error("Managed child requires a stable identity and matching workspace");
    const previous = this.store.read().nativeChildren?.[input.id];
    if (previous !== undefined) {
      if (previous.parentSessionId !== parentId) throw new Error("Managed child parent identity mismatch");
      // A repeated creation uses the original snapshot, even after a profile switch.
      return this.get(parentId, input.id);
    }
    this.store.putNativeChild({ id: input.id, parentSessionId: parentId, name: input.name, role: input.role, profile: input.profile,
      execution: structuredClone(input.execution), boundary: structuredClone(input.boundary), dispatches: [], acceptance: {},
      ...(input.strategy === undefined ? {} : { strategy: structuredClone(input.strategy) }),
      ...(input.coding === undefined ? {} : { coding: structuredClone(input.coding) }) });
    return this.get(parentId, input.id);
  }

  async list(parentId: string): Promise<readonly WorkerProjection[]> {
    this.parent(parentId);
    return Promise.all(Object.values(this.store.read().nativeChildren ?? {}).filter(record => record.parentSessionId === parentId && !record.closed).map(record => this.get(parentId, record.id)));
  }

  async get(parentId: string, id: string): Promise<WorkerProjection> {
    return this.project(this.record(parentId, id));
  }

  /**
   * Count the children of the given parent Sessions that are not confirmed idle.
   *
   * Capacity spans every Session that adopted a generation in one repository, so
   * this is the Host's own read-only statistic: it reads the records directly
   * instead of asking for each parent in turn, which would demand that the
   * caller be every one of them. Per-child operations keep their parent-identity
   * check; this entry grants no access to another Session's children.
   * @param parentIds - the parent Sessions whose children to count.
   * @returns how many of their open children are not confirmed idle.
   */
  async activeCount(parentIds: readonly string[]): Promise<number> {
    this.assertIdentity();
    const parents = new Set(parentIds);
    const records = Object.values(this.store.read().nativeChildren ?? {})
      .filter(record => !record.closed && parents.has(record.parentSessionId));
    const children = await Promise.all(records.map(record => this.project(record)));
    return children.filter(child => child.state !== "idle").length;
  }

  /** Project one stored child record from native facts. */
  private async project(record: NativeChildRecord): Promise<WorkerProjection> {
    const parentId = record.parentSessionId, id = record.id;
    this.assertIdentity();
    const active = this.ctx.agents.get(SessionId(id));
    if (active !== undefined && String(active.session.header.parentSession) !== parentId) throw new Error("Native child parent identity mismatch");
    // A bound execution compares native facts against the configuration its
    // current phase runs on, and treats an authorized switch in flight as
    // pending rather than as an unknown execution.
    const bound = this.boundInput(record);
    // A child that continues under another adapter has no native record there:
    // its turns are read from the DSH session the child still owns, so
    // completion never depends on a foreign thread identity.
    const native = bound.provider === NATIVE_EXECUTION_PROVIDER
      ? await this.ctx.codexExecution.read(id) as NativeFacts | undefined
      : undefined;
    const sessionTurns = bound.provider === NATIVE_EXECUTION_PROVIDER ? undefined : await this.sessionTurns(id);
    const switching = native?.pending !== undefined;
    let state: WorkerProjection["state"];
    if (sessionTurns !== undefined) {
      state = active?.status === "running" || active === undefined && sessionTurns.length === 0 && record.dispatches.length > 0
        ? "running" : "idle";
      if (active === undefined && sessionTurns.length === 0 && record.dispatches.length === 0) state = "idle";
    } else if (native === undefined) state = record.dispatches.length === 0 ? "idle" : active === undefined ? "unknown" : "running";
    else if (native.cwd !== record.boundary.cwd
      || (!switching && (native.model !== bound.model || native.reasoningEffort !== bound.reasoningEffort))) state = "unknown";
    else if (native.state === "unknown" || native.state === "saved") state = "unknown";
    else if (native.state === "waiting-approval" || native.state === "interrupt-requested") state = native.state;
    else if (native.state === "running" || native.state === "starting" || active?.status === "running") state = "running";
    else state = native.state === "idle" ? "idle" : "unknown";
    const dispatch = record.dispatches.at(-1);
    const nativeTurnId = native?.turnId ?? sessionTurns?.at(-1)?.turnId;
    const awaitingTurn = dispatch !== undefined && (nativeTurnId === undefined || nativeTurnId === dispatch.previousTurnId);
    if (awaitingTurn && state === "idle") state = active === undefined ? "unknown" : "running";
    const reports = (native?.reports ?? sessionTurns ?? []).map(report => ({ ...report, workerId: id,
      acceptance: record.acceptance[report.turnId]?.value ?? "pending", acknowledgedAt: record.acceptance[report.turnId]?.acknowledgedAt }));
    return { id, parentSessionId: parentId, name: record.name, role: record.role, profile: record.profile, cwd: record.boundary.cwd,
      model: native?.model ?? active?.options.model ?? bound.model,
      effort: native?.reasoningEffort ?? (active?.options.reasoningEffort === undefined ? bound.reasoningEffort : String(active.options.reasoningEffort)),
      threadId: native?.threadId, turnId: awaitingTurn ? undefined : nativeTurnId, state, reports,
      ...(native?.pending === undefined ? {} : { pending: native.pending }),
      ...(record.strategy === undefined ? {} : { strategy: record.strategy }),
      ...(record.handoff === undefined ? {} : { handoff: record.handoff }) };
  }

  /**
   * Read one child's completed turns from the DSH session it still owns.
   *
   * Used once an execution continues under an adapter that has no native reader
   * of its own: turn identity, terminal status and the model-visible final text
   * all come from the session log, so acceptance keeps the same meaning.
   * @param id - the child session id.
   * @returns one entry per closed turn, oldest first; `undefined` when the session or its log is unavailable.
   */
  /**
   * Read one child's completed turns from the DSH session it owns.
   *
   * Used once an execution continues under an adapter that has no native reader
   * of its own: turn identity, terminal status and the model-visible final text
   * all come from the session log, so acceptance keeps the same meaning. The
   * live registry is preferred, and the persisted log answers once the child's
   * agent is gone — reading only the live registry would leave a finished
   * successor looking like an execution with no turn at all, so a handover could
   * never be confirmed after its turn ended.
   * @param id - the child session id.
   * @returns one entry per closed turn, oldest first; `undefined` when the session or its log is unavailable.
   */
  private async sessionTurns(id: string): Promise<SessionTurn[] | undefined> {
    let session
    try { session = this.ctx.sessions.get(SessionId(id)) }
    catch { session = undefined }
    const live = session?.snapshotEvents?.();
    if (live !== undefined) return turnsOf(live, id);
    const persistence = (this.ctx as unknown as { get?: (name: string) => unknown }).get?.("sessionPersistence") as
      | { open?(session: unknown, mode: string): Promise<{ read(): Promise<{ events?: readonly unknown[] }>; close(): Promise<void> }> }
      | undefined;
    if (persistence?.open === undefined) return undefined;
    try {
      const handle = await persistence.open(SessionId(id), "read");
      try { return turnsOf((await handle.read()).events ?? [], id); }
      finally { await handle.close(); }
    } catch { return undefined; }
  }

  /** The model configuration this record's current phase runs on. */
  private boundInput(record: NativeChildRecord): RoleInput {
    const tier = record.strategy?.tier;
    const snapshot = tier === undefined ? undefined : record.coding?.[tier];
    return snapshot === undefined
      ? { provider: record.execution.provider, model: record.execution.model, reasoningEffort: record.execution.reasoningEffort }
      : snapshot;
  }

  /**
   * Settle one execution's control report for its bound phase.
   *
   * Only a `bootstrap` opening phase authorizes a handoff, and only after the
   * native turn that reported it has ended. The Host then continues the same
   * task and attempt on a successor child bound to the target tier; the parent
   * model neither approves the switch nor reads the whole log.
   * @param parentId - the authorizing parent Session.
   * @param id - the managed child that reported.
   * @param turnId - the completed turn whose report is being read.
   * @returns whether this call performed the handoff.
   */
  async settleControl(parentId: string, id: string, turnId: string): Promise<ControlOutcome> {
    const record = this.record(parentId, id);
    const worker = await this.get(parentId, id);
    if (worker.state !== "idle") throw new Error("Execution is not confirmed idle");
    const report = worker.reports.find(candidate => candidate.turnId === turnId);
    if (report === undefined || report.status !== "completed") throw new Error("A completed report is required");
    const signal = parseControlSignal(report.result);
    if (signal === undefined) return { accepted: false };
    const binding = record.strategy;
    const phase = `${binding?.effective ?? "unbound"} phase ${binding?.phase ?? "unknown"}`;
    if (signal.kind === "consult") {
      // Bounded consultation is a separate lifecycle: the workflow layer owns
      // the expert child, its read-only boundary and the conclusion hand-back,
      // so this call reports the signal without acting on it.
      return { accepted: false, signal };
    }
    if (binding?.effective !== "bootstrap" || binding.tier !== "sup" || binding.phase === "continuation") {
      return { accepted: false, signal, reason: `execution control handoff is not authorized for ${phase}` };
    }
    return await this.handoffToSuccessor(parentId, id, turnId, signal);
  }

  /**
   * Continue one opening execution on a successor child.
   *
   * The request identity and the successor child id are recorded before any
   * side effect, and every step is idempotent, so a lost response or a Host
   * restart completes the recorded handover instead of dispatching a second
   * continuation. In the Codex-to-Codex route the provider moves the original
   * native thread to the successor; across providers the successor imports the
   * source's sourced executed facts and no thread is shared.
   * @param parentId - the authorizing parent Session.
   * @param fromWorker - the opening execution that asked for the handoff.
   * @param sourceTurnId - the completed turn that carried the control report.
   * @param signal - the parsed handoff report.
   * @returns the settled control outcome.
   */
  private async handoffToSuccessor(parentId: string, fromWorker: string, sourceTurnId: string, signal: HandoffSignal): Promise<ControlOutcome> {
    const current = this.record(parentId, fromWorker);
    const recorded = current.handoff;
    if (recorded !== undefined && recorded.sourceTurnId !== sourceTurnId) throw new Error("a handoff is already recorded for this execution");
    if (recorded === undefined) {
      const refusal = await this.reserveSuccessor(current, sourceTurnId, signal);
      if ("reason" in refusal) return { accepted: false, signal, reason: refusal.reason };
    }
    let handoff = this.record(parentId, fromWorker).handoff!;
    const target = current.coding![handoff.targetTier];
    const successor = this.successorCapture(current);
    const sameProvider = target.provider === current.execution.provider;
    // Bind the original thread before the successor exists: its first model call
    // resumes that thread, and a binding that fails keeps the recorded request
    // for a retry rather than permitting a replacement thread.
    if (sameProvider && handoff.status === "reserved") {
      const service = this.threadHandoff();
      if (service === undefined) {
        return { accepted: false, signal, reason: "the installed provider package cannot transfer a Codex thread; rebuild and install the coordinated package set before using bootstrap" };
      }
      let bound;
      try {
        bound = await service.handoff({ requestId: handoff.requestId, fromSessionId: fromWorker, toSessionId: handoff.toWorker,
          model: target.model, reasoningEffort: target.reasoningEffort,
          boundary: { cwd: current.boundary.cwd, writableRoots: current.boundary.writableRoots, network: current.boundary.network } });
      } catch (error) {
        return { accepted: false, signal, reason: `the Codex thread handover did not bind: ${String(error)}` };
      }
      handoff = this.putHandoff(parentId, fromWorker, { ...handoff, status: "bound", threadId: bound.threadId });
    }
    // Creation and the keyed first dispatch both tolerate repetition; a recorded
    // request that already started is never sent twice.
    if (handoff.status === "reserved" || handoff.status === "bound") {
      await this.create(parentId, { role: successor.role, profile: successor.profile, execution: successor.execution,
        ...(successor.strategy === undefined ? {} : { strategy: successor.strategy }),
        ...(successor.coding === undefined ? {} : { coding: successor.coding }),
        id: handoff.toWorker, name: successor.name, cwd: successor.boundary.cwd, managed: true, boundary: successor.boundary });
      const started = await this.append(parentId, handoff.toWorker, handoff.prompt, true, `${handoff.requestId}:continue`);
      handoff = this.putHandoff(parentId, fromWorker, { ...handoff, status: "started",
        messageId: this.record(parentId, started.id).dispatches.at(-1)?.messageId });
    }
    return { accepted: true, signal, handoff };
  }

  /**
   * Record a successor before any side effect and return it, or refuse the
   * handover with the capability this route is missing.
   * @param current - the opening execution's record.
   * @param sourceTurnId - the completed turn that requested the handoff.
   * @param signal - the parsed handoff report.
   * @returns the recorded handover, or the refusal reason.
   */
  private async reserveSuccessor(current: NativeChildRecord, sourceTurnId: string, signal: HandoffSignal): Promise<{ handoff: HandoffRecord } | { reason: string }> {
    if (signal.target !== "def") return { reason: `handoff target ${signal.target} is not reachable from the opening phase` };
    if (current.coding === undefined || current.strategy === undefined || current.profile === undefined) {
      throw new Error("Execution has no bound Profile snapshot to continue from");
    }
    const target = current.coding[signal.target];
    const crossProvider = target.provider !== current.execution.provider;
    // Continuing under another adapter loses the native thread, so the executed
    // facts of the previous adapter must travel with the continuation prompt.
    // Without a projector the handoff is refused with its concrete reason
    // instead of dropping the implementation history.
    let facts: readonly string[] | undefined;
    if (crossProvider) {
      const read = (this.ctx.codexExecution as { facts?: (sessionId: string) => Promise<readonly string[]> }).facts;
      if (read === undefined) {
        return { reason: `cross-provider continuation to ${target.provider} needs the installed provider package's sourced execution-fact projector` };
      }
      facts = await read.call(this.ctx.codexExecution, current.id);
    } else if (this.threadHandoff() === undefined) {
      return { reason: "the installed provider package cannot transfer a Codex thread; rebuild and install the coordinated package set before using bootstrap" };
    }
    const handoff: HandoffRecord = {
      requestId: `${current.id}:handoff:${sourceTurnId}`,
      fromWorker: current.id,
      sourceTurnId,
      // Fixed before any side effect, so a retry and a restart agree on one child.
      toWorker: randomUUID(),
      targetTier: signal.target,
      targetConfig: { provider: target.provider, model: target.model, reasoningEffort: target.reasoningEffort },
      prompt: handoffPrompt(signal, crossProvider ? facts ?? [] : undefined),
      status: "reserved",
      at: Date.now(),
    };
    // The requested handover and the successor's own record commit before
    // delivery, so the task's confirmation and release already cover a child
    // that has not started yet.
    this.store.putNativeChild({ ...current, handoff });
    this.store.putNativeChild(this.successorRecord(current, handoff));
    return { handoff };
  }

  /** The successor's execution: the bound def configuration with continuation prompts. */
  private successorCapture(current: NativeChildRecord): NativeChildRecord {
    const binding = bindCodingStrategy(snapshotProfile(current.coding!), current.strategy!.requested, "continuation");
    const capture = this.captureSnapshot(current.role, current.profile, current.coding!, boundStrategy(binding), binding.prompts);
    return { id: "", parentSessionId: current.parentSessionId, name: `${current.name} continue`, role: current.role, profile: current.profile,
      execution: capture.execution, boundary: current.boundary,
      ...(capture.strategy === undefined ? {} : { strategy: capture.strategy }),
      ...(capture.coding === undefined ? {} : { coding: capture.coding }),
      dispatches: [], acceptance: {} };
  }

  /** The durable record of one reserved successor, before its child exists. */
  private successorRecord(current: NativeChildRecord, handoff: HandoffRecord): NativeChildRecord {
    const successor = this.successorCapture(current);
    return { ...successor, id: handoff.toWorker, boundary: structuredClone(current.boundary), execution: structuredClone(successor.execution),
      handoffFrom: { fromWorker: current.id, requestId: handoff.requestId } };
  }

  /** Persist one handover on its source record and return it. */
  private putHandoff(parentId: string, fromWorker: string, handoff: HandoffRecord): HandoffRecord {
    const source = this.record(parentId, fromWorker);
    this.store.putNativeChild({ ...source, handoff: { ...handoff, at: Date.now() } });
    return handoff;
  }

  /**
   * Confirm one recorded handover from the successor's own native facts.
   *
   * The successor's first turn is the durable boundary between the opening and
   * continuing phases; it is observed rather than assumed from delivery, so a
   * lost response never invents one.
   * @param parentId - the authorizing parent Session.
   * @param handoff - the recorded handover.
   * @param turnId - the turn the successor currently reports.
   * @param threadId - the native thread the successor owns, when exposed.
   * @returns the updated handover, or `undefined` when nothing changed.
   */
  confirmHandoff(parentId: string, handoff: HandoffRecord, turnId: string | undefined, threadId: string | undefined): HandoffRecord | undefined {
    if (handoff.status === "confirmed" || turnId === undefined || turnId === handoff.sourceTurnId) return undefined;
    const confirmed: HandoffRecord = { ...handoff, status: "confirmed", targetTurnId: turnId,
      ...(threadId === undefined ? {} : { threadId }), at: Date.now() };
    this.putHandoff(parentId, handoff.fromWorker, confirmed);
    return confirmed;
  }

  /**
   * The continuation capabilities the installed package set provides: the
   * controlled Codex thread handover for a same-provider continuation and the
   * sourced fact projector for a cross-provider one. A handover names the
   * capability its own route needs, so this summary only reports availability.
   */
  handoffSupport(): { supported: boolean; threadHandoff: boolean; factImport: boolean; reason?: string } {
    const threadHandoff = this.threadHandoff() !== undefined;
    const factImport = typeof (this.ctx.codexExecution as { facts?: unknown }).facts === "function";
    return threadHandoff || factImport
      ? { supported: true, threadHandoff, factImport }
      : { supported: false, threadHandoff, factImport,
        reason: "the installed package set provides neither the controlled Codex thread handover nor the sourced execution-fact projector" };
  }

  /** The trusted-Host thread handover service, when the installed provider publishes one. */
  private threadHandoff(): ThreadHandoffService | undefined {
    return (this.ctx as unknown as { get(name: string): unknown }).get("codexHandoff") as ThreadHandoffService | undefined;
  }

  /**
   * Start one bounded consultation child for a requesting worker.
   *
   * The expert runs as the same `coding_worker` role on the Profile's sup
   * configuration with only the consultation prompt bound, and its execution
   * boundary grants write access to its own artifacts — never the requesting
   * worker's workspace. Identity, residency and reporting stay the ordinary
   * managed-child path.
   * @param parentId - the authorizing parent Session.
   * @param id - the reserved consultation child identity.
   * @param request - the bounded question and its read-only workspace.
   * @returns the started expert's projection.
   */
  async startConsultation(parentId: string, id: string, request: ConsultationRequest): Promise<WorkerProjection> {
    const capture = this.captureSnapshot(CODING_WORKER, request.profile, request.coding,
      { requested: "adaptive", effective: "independent", tier: "sup", phase: "consultation" }, ["coding-consultation"]);
    const boundary: Boundary = { cwd: request.cwd, artifacts: request.artifacts, results: request.results,
      writableRoots: [request.artifacts], network: request.network, ports: {} };
    await this.create(parentId, { ...capture, id, name: `consult ${request.workerId}`, cwd: request.cwd, managed: true, boundary });
    return await this.append(parentId, id, request.prompt, true, request.startKey);
  }

  async append(parentId: string, id: string, text: string, managed = false, idempotencyKey?: string): Promise<WorkerProjection> {
    const parent = this.parent(parentId); this.managed(managed);
    if (!text.trim()) throw new Error("Task text must not be empty");
    const record = structuredClone(this.record(parentId, id));
    if (record.closed) throw new Error("Workflow child is closed");
    const key = idempotencyKey ?? `${id}:${record.dispatches.length + 1}`;
    const prior = record.dispatches.find(dispatch => dispatch.key === key);
    if (prior !== undefined) {
      if (prior.text !== text) throw new Error("Idempotency key input mismatch");
      const current = await this.get(parentId, id);
      if (prior.phase === "pending" && current.turnId === undefined) throw new Error("Native inbox acceptance is unknown; do not redispatch");
      return current;
    }
    const current = await this.get(parentId, id);
    if (current.state !== "idle") throw new Error(`Worker is ${current.state}; no new task was sent`);
    const initial = record.dispatches.length === 0;
    record.dispatches.push({ key, text, phase: "pending", previousTurnId: current.turnId });
    this.assertIdentity(); this.store.putNativeChild(record);
    const { signal } = this.context();
    let messageId: string;
    if (initial) {
      // The role's instructions are this plugin's own content, so they are
      // injected as the child's opening prompt: no core has to carry a plugin
      // field for them, and the provider needs to know nothing about workflow
      // roles. What stays in `execution` is the declared boundary, which is a
      // permission constraint the Codex provider has to translate rather than
      // prompt text.
      const agentOptions: ChildAgentOptions = {
        provider: record.execution.provider, model: record.execution.model, reasoningEffort: ReasoningEffortId(record.execution.reasoningEffort),
        execution: { boundary: { cwd: record.boundary.cwd, writableRoots: record.boundary.writableRoots, network: record.boundary.network } },
      };
      const created = await this.ctx.subagents.startContinuable({ provider: "spawn", label: record.name, childId: SessionId(id), signal,
        request: { parent, prompt: openingPrompt(record.execution.developerInstructions, text), agentOptions } });
      messageId = created.messageId;
    } else {
      messageId = await queueHostSubagentPrompt(this.ctx.subagents, parent, SessionId(id), [{ type: "text", text }], { kind: "user" }, signal);
    }
    this.assertIdentity();
    record.dispatches[record.dispatches.length - 1] = { key, text, phase: "accepted", previousTurnId: current.turnId, messageId };
    this.store.putNativeChild(record);
    return this.get(parentId, id);
  }

  async steer(parentId: string, id: string, turnId: string, text: string, managed = false): Promise<void> {
    this.managed(managed);
    const worker = await this.get(parentId, id); this.expectedTurn(worker, turnId);
    if (worker.state !== "running") throw new Error(`Cannot steer worker ${worker.state}`);
    await steerHostSubagentPrompt(this.ctx.subagents, this.parent(parentId), SessionId(id), [{ type: "text", text }], { kind: "user" }, this.context().signal);
    this.assertIdentity();
  }

  async interrupt(parentId: string, id: string, turnId: string, managed = false): Promise<void> {
    this.managed(managed); this.expectedTurn(await this.get(parentId, id), turnId);
    this.ctx.subagents.interrupt(SessionId(id), { kind: "ancestor", agent: this.parent(parentId) });
    this.assertIdentity();
  }

  async accept(parentId: string, id: string, turnId: string, acceptance: ReportAcceptance, managed = false): Promise<Report> {
    this.managed(managed);
    const worker = await this.get(parentId, id);
    if (worker.state !== "idle") throw new Error("Execution is not confirmed idle");
    const report = worker.reports.find(report => report.turnId === turnId);
    if (report === undefined || report.status !== "completed") throw new Error("A completed report is required");
    if (!["pending", "accepted", "changes-requested"].includes(acceptance)) throw new Error("Unknown report acceptance");
    if (acceptance === "accepted" && (report.protocolError !== undefined || !report.result.trim())) throw new Error("Cannot accept a report without a deliverable result");
    const record = structuredClone(this.record(parentId, id));
    const acknowledgedAt = report.acknowledgedAt ?? (acceptance === "pending" ? undefined : Date.now());
    record.acceptance[turnId] = { value: acceptance, acknowledgedAt };
    this.store.putNativeChild(record);
    return { ...report, acceptance, acknowledgedAt };
  }

  async acknowledge(parentId: string, id: string, turnId: string): Promise<Report> {
    const report = await this.report(parentId, id, turnId);
    const record = structuredClone(this.record(parentId, id));
    const acknowledgedAt = report.acknowledgedAt ?? Date.now();
    record.acceptance[turnId] = { value: report.acceptance, acknowledgedAt };
    this.store.putNativeChild(record);
    return { ...report, acknowledgedAt };
  }

  async closeWorker(parentId: string, id: string, _confirmedStopped = false, managed = false): Promise<void> {
    this.managed(managed);
    const worker = await this.get(parentId, id);
    if (worker.state !== "idle" || worker.reports.some(report => report.acknowledgedAt === undefined)) throw new Error("Confirm native terminal execution and acknowledge reports before closing");
    this.store.putNativeChild({ ...this.record(parentId, id), closed: true });
  }

  async report(parentId: string, id: string, turnId?: string): Promise<Report> {
    const reports = (await this.get(parentId, id)).reports;
    const report = turnId === undefined ? reports.at(-1) : reports.find(report => report.turnId === turnId);
    if (report === undefined) throw new Error("Report not found");
    return report;
  }

  private context() { const value = this.request.getStore(); if (value === undefined) throw new Error("Managed workflow request context is unavailable"); return value; }
  /**
   * The owning Session's workspace.
   *
   * A delegation that names no directory runs where its parent runs, which the
   * caller cannot read from the tool arguments.
   * @param parentId - the owning DSH Session.
   * @returns the parent Session's absolute working directory.
   */
  parentCwd(parentId: string): string {
    const cwd = this.parent(parentId).session.header.cwd;
    if (typeof cwd !== "string" || cwd === "") throw new Error("The owning Session has no workspace to delegate from");
    return cwd;
  }

  private parent(parentId: string): Agent { this.assertIdentity(); const { parent, session } = this.context(); if (String(session.id) !== parentId) throw new Error("Managed workflow parent identity mismatch"); return parent; }
  private record(parentId: string, id: string): NativeChildRecord { this.parent(parentId); const record = this.store.read().nativeChildren?.[id]; if (record === undefined || record.parentSessionId !== parentId) throw new Error("Managed workflow child not found"); return record; }
  private managed(value: boolean | undefined): void { if (value !== true) throw new Error("Managed workflow child requires codex_workflow"); }
  private expectedTurn(worker: WorkerProjection, turnId: string): void { if (!turnId || worker.turnId !== turnId) throw new Error("Turn identity mismatch"); }
}

/** Reduce one resolved binding to the durable record kept with an execution. */
function boundStrategy(binding: StrategyBinding): BoundStrategy {
  return { requested: binding.requested, effective: binding.effective, tier: binding.tier, phase: binding.phase };
}
