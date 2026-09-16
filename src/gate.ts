/**
 * The workflow session gate's business rules.
 *
 * One deterministic function decides every pre-execution question the workflow
 * asks, for both entry points: the DSH native tool pipeline calls it through a
 * registered guard, and the Codex PreToolUse hook calls the same function
 * through the provider's callback. Nothing here calls a model, and no rule
 * inspects a shell program's effect on the filesystem.
 *
 * `role` is this Host's own business label. The provider never enumerates it.
 * @module dsh-workflow-kit/gate
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { CODING_WORKER } from "./roles.js";
import type { CodexToolGate, GateBinding, GateDecision, GateEvent } from "./types.js";

/** The single business hook both entry points address. */
export const WORKFLOW_GATE_HOOK = "workflow.preToolUse";

/** The Host business label the manager Session is bound under. */
export const MANAGER_ROLE = "manager";

/**
 * Every denial this module produces starts with this prefix. The DSH guard's
 * denial carries no error code — only `Error: <reason>` — so the prefix is what
 * makes a gate refusal machine-recognizable in a session log.
 */
export const GATE_DENY_PREFIX = "workflow gate: ";

/** One authorized write target: a single file, or a directory and its descendants. */
export interface PathGrant {
  path: string;
  kind: "file" | "directory";
}

/**
 * The JSON arguments one Session's gate binding carries.
 *
 * Every path is absolute and resolved when the binding is built, so a rule
 * never resolves anything against the DSH process's own working directory.
 */
export interface WorkflowGateArgs {
  /**
   * The directory the assignment was created in, recorded so a refusal can name
   * the scope the caller expected. Authorization never compares it: which paths
   * may be written is the grants' business, and the operation's own reported
   * directory is what resolves a relative path.
   */
  cwd: string;
  /** The attempt's lane, when the assignment owns one. */
  lane?: string;
  /** Product files the current assignment explicitly owns. */
  productWrites: PathGrant[];
  /** Explicitly assigned temporary, build, report and artifact paths. */
  auxiliaryWrites: PathGrant[];
  /** Explicitly assigned shared control documents. */
  sharedWrites: PathGrant[];
}

/**
 * Tools that fan out or steer other agents. A registered child must not start
 * work the Host has not registered, and the manager must not start unregistered
 * children — either would run a session this gate never sees.
 *
 * The names are the real registered ones: `subagent_fork` is the shipped preset
 * alias for `subagent`, and both exist in this deployment. A name list cannot
 * follow `mcp__*` or the `cordis_*` runtime, which is why those two entry
 * points are documented as uncovered instead.
 */
const SCHEDULING_TOOLS = new Set([
  "subagent", "subagent_fork", "workflow", "ralph", "spawn_teammate", "wait_agent",
  "team_task_create", "team_task_list", "team_task_get", "team_task_update",
  "send_message", "interrupt_agent", "codex_workers",
  "spawn_agent", "Agent", "resume_agent", "close_agent",
]);

/**
 * Every known shell entry point, by the name the caller actually uses. The
 * manager is refused the whole entry point rather than a guessed command list.
 * A registered child may use a shell: this gate does not read the program's
 * file effects, and the existing sandbox still applies.
 */
const SHELL_TOOLS = new Set(["bash", "pwsh", "Bash", "exec_command", "shell", "shell_command", "write_stdin"]);

/** `str_replace_editor` commands that write; `view` is a read. */
const EDITOR_WRITE_COMMANDS = new Set(["create", "str_replace", "insert"]);

/** A denial carrying this module's fixed, machine-recognizable prefix. */
function deny(reason: string): GateDecision {
  return { kind: "deny", reason: `${GATE_DENY_PREFIX}${reason}` };
}

const ALLOW: GateDecision = { kind: "allow" };

/**
 * Whether one path lies inside one grant. A `file` grant matches exactly its
 * own path; a `directory` grant matches the directory and every descendant.
 * The comparison is a real path-relative one, so `lane-other` never matches a
 * `lane` grant and a `..` segment is rejected instead of string-compared.
 * @param grant - the authorized target.
 * @param target - the absolute path under test.
 * @returns whether the target is authorized by this grant alone.
 */
export function within(grant: PathGrant, target: string): boolean {
  const rel = relative(grant.path, target);
  if (rel === "") return true;
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  return grant.kind === "directory";
}

/**
 * Resolve one path's filesystem identity: the nearest existing ancestor is
 * canonicalized and the still-missing tail is reattached segment by segment.
 * @param target - an absolute path that may not exist yet.
 * @returns the resolved absolute path a write would actually reach.
 */
export function resolvedTarget(target: string): string {
  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const tail = relative(existing, target);
  const real = realpathSync(existing);
  return tail === "" ? real : join(real, tail);
}

/**
 * The grant kind an assigned path actually has.
 *
 * An existing directory is a directory grant; everything else — including a
 * path that does not exist yet — is a file grant. A directory that has to be
 * created is created by the Host before it is registered, so an unknown path is
 * never guessed into a directory grant that would authorize its whole subtree.
 * @param path - an absolute assigned path.
 * @returns the grant for that path.
 */
export function pathGrant(path: string): PathGrant {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error(`Gate grant path must be absolute: ${String(path)}`);
  const target = resolve(path);
  const kind = existsSync(target) && statSync(target).isDirectory() ? "directory" : "file";
  return { path: target, kind };
}

/** The inputs the Host builds one Session's binding from. */
export interface GateArgsInput {
  cwd: string;
  lane?: string;
  productWrites?: readonly string[];
  auxiliaryWrites?: readonly string[];
  sharedWrites?: readonly string[];
}

/**
 * Build one Session's gate arguments.
 *
 * Path grants are absolute by the time they arrive: the Host resolves each
 * against the assignment's real cwd, which exists by then. A product write
 * outside the lane is a construction error rather than a runtime refusal — a
 * binding must not be able to express an authorization the rules would ignore.
 * @param input - the assignment's cwd, lane and three explicit write sets.
 * @returns the normalized arguments.
 */
export function buildGateArgs(input: GateArgsInput): WorkflowGateArgs {
  if (typeof input.cwd !== "string" || !isAbsolute(input.cwd)) throw new Error("Gate args require an absolute cwd");
  if (input.lane !== undefined && !isAbsolute(input.lane)) throw new Error("Gate args require an absolute lane");
  const grants = (paths: readonly string[] | undefined): PathGrant[] => {
    const byPath = new Map<string, PathGrant>();
    for (const path of paths ?? []) byPath.set(resolve(path), pathGrant(path));
    return [...byPath.values()];
  };
  const productWrites = grants(input.productWrites);
  if (input.lane !== undefined) {
    const lane: PathGrant = { path: resolve(input.lane), kind: "directory" };
    for (const grant of productWrites) {
      if (!within(lane, grant.path)) throw new Error(`Product write is outside the assignment lane: ${grant.path}`);
    }
  }
  return { cwd: resolve(input.cwd), ...(input.lane === undefined ? {} : { lane: resolve(input.lane) }),
    productWrites, auxiliaryWrites: grants(input.auxiliaryWrites), sharedWrites: grants(input.sharedWrites) };
}

/**
 * Bind one role to one assignment's arguments.
 *
 * Which assignment kinds may carry product grants is decided where the binding
 * is built, from the frozen contract: only a coding assignment and an
 * integration repair own product files, so a reviewer, planner or consultation
 * binding is built with no product grant at all.
 * @param role - this Host's business label for the child.
 * @param args - the built arguments.
 * @returns the binding the provider stores and the guard reads back.
 */
export function gateBinding(role: string, args: WorkflowGateArgs): GateBinding {
  if (typeof role !== "string" || role.length === 0) throw new Error("A gate role label is required");
  return { role, hook: WORKFLOW_GATE_HOOK, args: args as unknown as Record<string, unknown> };
}

/**
 * Whether one role may be granted product write paths.
 *
 * The unified coding worker and an integration repair (which runs under the
 * contract's own role) are the only assignments that own product files.
 * @param role - the Host business label.
 * @returns whether a product grant is meaningful for that role.
 */
export function ownsProductWrites(role: string): boolean {
  return role === CODING_WORKER;
}

/**
 * Re-read one binding's arguments, refusing anything the rules cannot interpret.
 * @param value - the binding's `args`.
 * @returns the validated arguments, or `undefined` when they are unusable.
 */
export function readGateArgs(value: unknown): WorkflowGateArgs | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const args = value as Partial<WorkflowGateArgs>;
  if (typeof args.cwd !== "string" || !isAbsolute(args.cwd)) return undefined;
  if (args.lane !== undefined && (typeof args.lane !== "string" || !isAbsolute(args.lane))) return undefined;
  const grants = (value: unknown): PathGrant[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const out: PathGrant[] = [];
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null) return undefined;
      const grant = entry as Partial<PathGrant>;
      if (typeof grant.path !== "string" || !isAbsolute(grant.path)) return undefined;
      if (grant.kind !== "file" && grant.kind !== "directory") return undefined;
      out.push({ path: grant.path, kind: grant.kind });
    }
    return out;
  };
  const productWrites = grants(args.productWrites), auxiliaryWrites = grants(args.auxiliaryWrites), sharedWrites = grants(args.sharedWrites);
  if (productWrites === undefined || auxiliaryWrites === undefined || sharedWrites === undefined) return undefined;
  return { cwd: args.cwd, ...(args.lane === undefined ? {} : { lane: args.lane }), productWrites, auxiliaryWrites, sharedWrites };
}

/** The paths one tool call would write, a read-only marker, or a refusal reason. */
export type WriteTargets = { paths: string[] } | { read: true } | { error: string };

/**
 * Extract the write targets of one known tool call.
 *
 * Only the tools whose write target is unambiguous are read; an unknown tool is
 * not this gate's business. A known write tool whose target cannot be read
 * completely is refused rather than partially allowed.
 * @param toolName - the tool name the caller actually invoked.
 * @param toolArgs - the complete original arguments.
 * @returns the extracted targets, a read-only marker, or a refusal reason.
 */
export function writeTargets(toolName: string, toolArgs: unknown): WriteTargets {
  const args = typeof toolArgs === "object" && toolArgs !== null ? toolArgs as Record<string, unknown> : {};
  if (toolName === "write" || toolName === "edit") return { paths: [stringField(args.file_path)] };
  if (toolName === "str_replace_editor") {
    const command = args.command;
    if (command === "view") return { read: true };
    if (typeof command !== "string" || !EDITOR_WRITE_COMMANDS.has(command)) return { error: `str_replace_editor command ${JSON.stringify(command)} is unknown` };
    return { paths: [stringField(args.path)] };
  }
  if (toolName === "apply_patch") return patchTargets(args.command);
  return { read: true };
}

/** One required string field, or an empty marker the caller turns into a refusal. */
function stringField(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "";
}

/**
 * Every path one Codex patch touches.
 *
 * Only the shipped `*** Begin Patch` / `*** End Patch` format is read. The
 * directives are the only path carriers: a file name appearing in a diff body
 * is content, not a directive, so it is never matched. One patch is one call,
 * so a single unauthorized path refuses the whole patch rather than part of it.
 * @param command - the patch text.
 * @returns the extracted paths, or a refusal reason.
 */
export function patchTargets(command: unknown): WriteTargets {
  if (typeof command !== "string" || command.trim() === "") return { error: "apply_patch has no patch text" };
  const lines = command.split("\n");
  if (!lines.some(line => line.trimEnd() === "*** Begin Patch")) return { error: "apply_patch text has no *** Begin Patch marker" };
  if (!lines.some(line => line.trimEnd() === "*** End Patch")) return { error: "apply_patch text has no *** End Patch marker" };
  const paths: string[] = [];
  // The most recent Update directive that has not consumed its Move yet: a Move
  // belongs to the Update section it follows, so a Move without one is refused
  // instead of being attributed to the wrong file.
  let pendingUpdate: string | undefined;
  for (const line of lines) {
    const directive = (prefix: string): string | undefined => line.startsWith(prefix) ? line.slice(prefix.length).trim() : undefined;
    const add = directive("*** Add File: "), remove = directive("*** Delete File: ");
    const update = directive("*** Update File: "), move = directive("*** Move to: ");
    if (add !== undefined) { if (add === "") return { error: "apply_patch names an empty Add File path" }; paths.push(add); pendingUpdate = undefined; continue; }
    if (remove !== undefined) { if (remove === "") return { error: "apply_patch names an empty Delete File path" }; paths.push(remove); pendingUpdate = undefined; continue; }
    if (update !== undefined) { if (update === "") return { error: "apply_patch names an empty Update File path" }; paths.push(update); pendingUpdate = update; continue; }
    if (move !== undefined) {
      if (move === "") return { error: "apply_patch names an empty Move to path" };
      if (pendingUpdate === undefined) return { error: "apply_patch moves a file no Update directive named" };
      paths.push(move); pendingUpdate = undefined;
    }
  }
  if (paths.length === 0) return { error: "apply_patch names no file operation" };
  return { paths };
}

/**
 * Resolve one tool-supplied path and require its lexical form and its resolved
 * form to sit inside one and the same grant.
 *
 * The resolved form is what refuses a symlink that points out of an authorized
 * directory; the lexical form is what refuses a `../` traversal whose resolved
 * form happens to land back inside. Requiring one shared grant keeps a file
 * grant from borrowing its parent directory's authority.
 * @param target - the path the tool named.
 * @param cwd - the trusted operation cwd relative paths resolve against.
 * @param grants - the grants allowed to authorize this target.
 * @returns the resolved absolute path, or a refusal reason.
 */
function authorizePath(target: string, cwd: string, grants: readonly PathGrant[]): { path: string } | { reason: string } {
  if (target === "") return { reason: "the file write tool names no path" };
  const lexical = resolve(cwd, target);
  const resolved = resolvedTarget(lexical);
  const lexicalGrants = grants.filter(grant => within(grant, lexical));
  if (lexicalGrants.length === 0) return { reason: `write outside assigned paths: ${lexical}` };
  if (!lexicalGrants.some(grant => within(grant, resolved))) return { reason: `write resolves outside assigned paths: ${resolved}` };
  return { path: lexical };
}

/**
 * The one business handler both entry points call.
 *
 * The decision is a pure function of the binding's arguments and the event.
 * @param binding - the Session's binding.
 * @param event - the operation about to execute.
 * @returns allow, or a denial naming the rule that refused.
 */
export function workflowGateHandler(binding: Readonly<GateBinding>, event: Readonly<GateEvent>): GateDecision {
  const args = readGateArgs(binding.args);
  if (args === undefined) return deny("this Session's gate arguments are unreadable");
  const manager = binding.role === MANAGER_ROLE;
  if (typeof event.toolName !== "string" || event.toolName === "") return deny("the operation has no tool name");
  // A scheduling entry point is refused for every registered Session: a child
  // that starts work itself would run a session this gate never registered, and
  // a manager that started one would make its own shell refusal meaningless.
  if (SCHEDULING_TOOLS.has(event.toolName)) return deny(`${event.toolName} is the Host's lifecycle decision, not a worker's`);
  if (manager && SHELL_TOOLS.has(event.toolName)) return deny(`manager does not run ${event.toolName}; dispatch the work to the session that owns it`);
  const targets = writeTargets(event.toolName, event.toolArgs);
  if ("read" in targets) return ALLOW;
  if ("error" in targets) return deny(targets.error);
  // The operation's own directory is what resolves a relative path; without one
  // there is nothing to resolve against, so the write is refused rather than
  // guessed from the server's launch directory. It is not required to equal the
  // assignment's directory: an assignment states which paths may be written, not
  // where the caller happens to stand, and an authorized absolute path is
  // authorized from anywhere. Whatever the resolved path does not fall inside is
  // refused below, which is the check that actually constrains the write.
  if (typeof event.cwd !== "string" || event.cwd === "") return deny("session has no working directory");
  const cwd = resolve(event.cwd);
  // The manager owns no product files; product grants are additionally confined
  // to the lane, while auxiliary and shared grants may sit outside it — but only
  // their own grant authorizes them.
  const product = manager ? [] : args.productWrites;
  const lane: PathGrant | undefined = args.lane === undefined ? undefined : { path: args.lane, kind: "directory" };
  const grants = [...product, ...args.auxiliaryWrites, ...args.sharedWrites];
  for (const target of targets.paths) {
    const authorized = authorizePath(target, cwd, grants);
    if ("reason" in authorized) return deny(authorized.reason);
    if (lane !== undefined && product.some(grant => within(grant, authorized.path)) && !within(lane, authorized.path)) {
      return deny(`product write outside the assignment lane: ${authorized.path}`);
    }
  }
  return ALLOW;
}

/**
 * The installed provider's gate capability, when the package set publishes one.
 *
 * Read through the context's service resolver rather than a declared property,
 * for the same reason the thread handover is: this plugin must build against a
 * provider package that predates the capability and then report the missing
 * route instead of assuming it.
 * @param ctx - the Host context.
 * @returns the capability, or `undefined` when the installed provider has none.
 */
export function installedCodexToolGate(ctx: Context): CodexToolGate | undefined {
  const value = (ctx as unknown as { get?(name: string): unknown }).get?.("codexToolGate");
  if (typeof value !== "object" || value === null) return undefined;
  const gate = value as Partial<CodexToolGate>;
  return typeof gate.register === "function" && typeof gate.bind === "function" ? gate as CodexToolGate : undefined;
}
