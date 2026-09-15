import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, realpathSync, unlinkSync } from 'node:fs'
import { join, isAbsolute, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import type { WorkflowWorkers } from './workers.js'
import type { Capture, Report } from './workers.js'
import { ROLES, CONFIG_KEYS, CODING_WORKER } from './roles.js'
import { CODING_CONFIG_KEY } from './constants.js'
import { bindIntegrateStrategy, snapshotProfile, type CodingPhase, type CodingStrategy, type EffectiveStrategy, type Tier } from './strategy.js'
import { parseControlSignal, type ConsultSignal } from './control.js'
import type { HandoffRecord, ReportUsage } from './workers.js'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { RoleInput } from './configuration.js'
import type { Boundary } from './types.js'

const exec = promisify(execFile)
type Task = { network?: 'disabled'|'loopback'; lane?: boolean; cwd?: string; reads?: string[]; writes?: string[]; reports?: string[]; ports?: string[]; id: string; revision: number; role: string; depends: string[]; owned: string[]; resources: string[]; inputs: string[]; review: string; text: string }
type Plan = { concurrency?: number; generation: string; revision: number; repository: string; target: string; base: string; delivery: string; text: string; policy: { initial: number; max: number; expand: boolean; bases: string[] }; tasks: Record<string, Task> }
type Review = { worker: string; turn?: string; candidate: string; target?: string; input: string; purpose?: 'disposition'; verdict?: string; report?: string }
/** The integrate strategy binding an integration keeps: later settings edits never rewrite it. */
type IntegrationBinding = { strategy: CodingStrategy; effectiveStrategy: EffectiveStrategy; tier: Tier; coding: { def: RoleInput; sup: RoleInput }; profile: string }
type Integration = { id: string; path: string; target: string; source: string; candidate?: string; conflict: boolean; requiredReview: boolean; review?: Review; resolution?: string; error?: string; delivered?: string } & Partial<IntegrationBinding>

/** Summed token accounting for one task or one run. */
type UsageTotal = { totalTokens: number; inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number; calls: number; unreported: number }

/** One turn whose provider reported no token accounting. */
const UNREPORTED_USAGE: ReportUsage = { totalTokens: null, inputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: null, reasoningOutputTokens: null }

/**
 * The prompt one bounded consultation child receives. It carries the original
 * assignment facts, the concrete question and the evidence bound to the
 * requesting turn, and it forbids taking over the task or writing the main
 * workspace.
 * @param signal - the requesting worker's consult report.
 * @param a - the attempt whose assignment the question belongs to.
 * @returns the expert's bounded assignment.
 */
function consultationPrompt(signal: ConsultSignal, a: Attempt): string {
  return [
    `Bounded consultation for ${a.task.id}-A${a.number} (contract revision ${a.task.revision}).`,
    'Analyze the question below and return a conclusion, its reasons and, when useful, code examples or a proposed patch.',
    'Do not modify the requesting workspace, apply patches there, take over the task, or create another expert. Write only the artifacts you were assigned.',
    'If the evidence is insufficient, state the missing fact. If direct implementation is needed, return a bounded coding-assignment recommendation instead of doing it.',
    '',
    `Question: ${signal.question}`,
    `Goal: ${signal.goal}`,
    `Choices: ${signal.choices}`,
    `Evidence: ${signal.evidence}`,
    `Expected conclusion: ${signal.expected}`,
    '',
    `The frozen contract is at ${a.contract}; the requesting attempt's assigned workspace is ${a.allocation?.cwd ?? 'unknown'} (read-only for you).`,
  ].join('\n')
}

/**
 * The prompt that returns one expert conclusion to the requesting worker.
 * @param consult - the recorded consultation.
 * @param answer - the expert's final reply.
 * @param stale - whether the attempt's contract was revised after the question was asked.
 * @returns the continuation prompt for the requesting worker.
 */
function consultationReturnPrompt(consult: ConsultRecord, answer: string, stale: boolean): string {
  return [
    'Continue the same assignment. A bounded consultation answered the question you submitted; apply the conclusion and verify the result yourself.',
    'Advice is not acceptance: the conclusion does not change the goal, contract, authority or acceptance, and you still own the implementation and its evidence.',
    ...(stale ? ['The task contract was revised after this question was asked, so treat the conclusion as historical evidence and re-derive what the current contract needs.'] : []),
    '',
    `Question: ${consult.question}`,
    '',
    'Consultation conclusion:',
    answer.trim(),
    '',
    'Continue until the assignment is complete or a concrete blocker requires a return. Request a further consultation only for a new, concrete question.',
  ].join('\n')
}

/** Every token field one aggregated total sums, in a fixed order. */
const USAGE_FIELDS = ["totalTokens", "inputTokens", "cachedInputTokens", "cacheWriteInputTokens", "outputTokens", "reasoningOutputTokens"] as const

/**
 * Sum distinct turns' native usage. Each entry is one turn's own accounting, so
 * repeated observations of the same turn are deduplicated by the caller before
 * they reach this function; a turn whose provider reported nothing increments
 * `unreported` instead of contributing zero.
 * @param entries - one entry per distinct native turn.
 * @returns the summed total.
 */
function aggregateUsage(entries: readonly ReportUsage[]): UsageTotal {
  const total: UsageTotal = { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, calls: entries.length, unreported: 0 }
  for (const entry of entries) {
    let reported = false
    for (const field of USAGE_FIELDS) {
      const value = entry[field]
      if (value === null || value === undefined) continue
      reported = true
      total[field] += value
    }
    if (!reported) total.unreported += 1
  }
  return total
}

/** The frozen coding binding one attempt keeps for its later phases. */
type AttemptBinding = { strategy?: CodingStrategy; effectiveStrategy?: EffectiveStrategy; tier?: Tier; phase?: CodingPhase; coding?: { def: RoleInput; sup: RoleInput }; profile?: string;
  /** The successor handoff this attempt performed, if its opening phase requested one. */
  handoff?: HandoffRecord;
  /** A control report this attempt submitted that its phase did not authorize. */
  control?: { turnId: string; signal: string; reason: string };
  /** Native token accounting by `workerId:turnId`, so repeated snapshots never double-count. */
  usage?: Record<string, ReportUsage>;
  /** The raw Outcome the worker's result report declared, kept distinct from processing state. */
  outcome?: string;
  /** Bounded consultations this attempt asked for, newest last. */
  consults?: ConsultRecord[] }
/** One bounded consultation's durable binding to the attempt that asked for it. */
type ConsultRecord = { id: string; /** Execution the conclusion returns to; a handoff never moves its requester. */ worker: string; sourceTurnId: string; question: string; contractRevision: number; evidence: string;
  state: 'running' | 'answered' | 'delivered'; answerTurnId?: string }
type Attempt = { supersededRevision?: number; task: Task; number: number; worker: string; turn?: string; initialPrompt?: string; initialStartKey?: string; lane?: string; allocation?: Boundary & { ports: Record<string, number> }; base: string; contract: string; directory: string; state: 'reserved'|'running'|'candidate'|'accepted'|'delivered'|'archived'|'released'|'unknown'|'blocked'; discarded?: boolean; candidate?: string; result?: string; review?: Review; previousReviews?: Review[]; integration?: Integration; previousIntegrations?: Integration[]; error?: string } & AttemptBinding
type Lane = { name: string; path: string; owner?: string }
type Run = { planSnapshot?: string; id: string; parent: string; plan: Plan; lanes: Lane[]; attempts: Attempt[] }
export type WorkflowAction = { action: string; generation?: string; task?: string; attempt?: number; lane?: string; base?: string; result?: string; text?: string; recipient?: string; processesStopped?: boolean;
  role?: string; worker?: string; stop?: boolean; cwd?: string; name?: string; writes?: readonly string[]; network?: 'disabled' | 'loopback' }

/** Contract state is serialized alongside the existing worker service and directory lock. */
export class Workflow {
  private runs: Run[]
  private directory: string
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly workers: WorkflowWorkers, readonly skillRoot?: string) {
    this.directory = workers.store.stateDir
    mkdirSync(this.directory, {recursive:true, mode:0o700})
    this.runs = workers.store.read().runs as Run[]
    for (const run of this.runs) {
      if (run.planSnapshot) {
        const snapshot:Plan=JSON.parse(readFileSync(run.planSnapshot,'utf8'))
        run.plan.text=snapshot.text
        for(const task of Object.values(run.plan.tasks)) task.text=snapshot.tasks[task.id].text
      }
      for(const attempt of run.attempts) attempt.task.text??=readFileSync(attempt.contract,'utf8')
    }
    const pools=new Map<string,Lane[]>()
    for (const run of this.runs) {
      const goal=dirname(run.plan.generation),pool=pools.get(goal)
      if (pool) {
        if (JSON.stringify(pool)!==JSON.stringify(run.lanes)) throw new Error('Conflicting persisted goal lane pools; resolve ownership before starting')
        run.lanes=pool
      } else pools.set(goal,run.lanes)
    }
    this.syncLanes()
  }
  private save() {
    this.workers.assertIdentity()
    for(const run of this.runs) {
      run.planSnapshot=join(this.directory,'plans',run.id,`revision-${run.plan.revision}.json`)
      if(!existsSync(run.planSnapshot)) {
        mkdirSync(dirname(run.planSnapshot),{recursive:true,mode:0o700})
        writeFileSync(run.planSnapshot+'.tmp',JSON.stringify(run.plan),{mode:0o600});renameSync(run.planSnapshot+'.tmp',run.planSnapshot)
      }
    }
    // Full contracts/plans live in immutable snapshots, not duplicate state fields.
    this.workers.store.read().runs=this.runs
    this.syncLanes();this.workers.store.save()
  }
  private syncLanes() { this.workers.store.read().lanes=[...new Map(this.runs.flatMap(run=>run.lanes).map(lane=>[lane.path,lane])).values()] }
  private async python(...args: string[]) {
    this.workers.assertIdentity()
    const result=await exec('python3',[fileURLToPath(new URL('../scripts/workflowctl.py', import.meta.url)),...args],{maxBuffer:8*1024*1024, env: {...process.env, DSH_ROLE_PROFILES: JSON.stringify(this.roleProfiles())} })
    this.workers.assertIdentity()
    return JSON.parse(result.stdout)
  }
  /**
   * The Role names a contract may bind. Execution roles are the catalog the
   * dispatch tool can start; the legacy coding keys stay acceptable so already
   * frozen contracts remain readable, while new coding work must name
   * `coding_worker`.
   */
  private roleProfiles() {
    const roles=this.workers.selectedRoles()
    const names=[...ROLES.map(role=>role.name),CODING_CONFIG_KEY.def,CODING_CONFIG_KEY.sup]
    return Object.fromEntries(names.map(name=>{
      const value=roles[name===CODING_WORKER?CODING_CONFIG_KEY.def:name]!
      return [name,{model:value.model,model_reasoning_effort:value.reasoningEffort}]
    }))
  }
  private async git(cwd: string, ...args: string[]) { this.workers.assertIdentity();const result=await exec('git',['-C',cwd,...args],{maxBuffer:16*1024*1024});this.workers.assertIdentity();return result.stdout.trimEnd() }
  private async commit(repo: string, value: string) {
    if (!value || value.startsWith('-')) throw new Error('Invalid commit identity')
    return this.git(repo,'rev-parse','--verify',`${value}^{commit}`)
  }
  private async retain(run: Run, attempt: Attempt, candidate: string) {
    await this.git(run.plan.repository,'update-ref',`refs/dsh-workflow/${run.id}/${attempt.task.id}-A${attempt.number}/${candidate}`,candidate)
  }
  private async clean(path: string) {
    if (await this.git(path,'status','--porcelain','--untracked-files=all','--','.',':(exclude)agentwork')) throw new Error(`Preserve uncommitted work in ${path} before continuing`)
    for (const marker of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply']) {
      if (existsSync(await this.git(path,'rev-parse','--path-format=absolute','--git-path',marker))) throw new Error(`Unfinished Git operation in ${path}`)
    }
  }
  private async ancestor(repo: string, base: string, tip: string) {
    try { await this.git(repo,'merge-base','--is-ancestor',base,tip); return true } catch (e) { if ((e as any).code === 1) return false; throw e }
  }
  private async paths(repo: string, base: string, tip: string) {
    // --no-renames includes both old and new names, including binary/deleted files.
    const {stdout} = await exec('git',['-C',repo,'diff','--name-only','--no-renames','-z',base,tip,'--'],{maxBuffer:16*1024*1024})
    return stdout.split('\0').filter(Boolean)
  }
  private async worktreeTree(repo: string, directory: string) {
    const index=join(directory,`verify-index-${randomUUID()}`)
    const env={...process.env,GIT_INDEX_FILE:index}
    try {
      await exec('git',['-C',repo,'read-tree','HEAD'],{env})
      await exec('git',['-C',repo,'add','-A','--','.',':(exclude)agentwork'],{env})
      return (await exec('git',['-C',repo,'write-tree'],{env})).stdout.trim()
    } finally {if(existsSync(index))unlinkSync(index)}
  }
  private overlaps(left: string[], right: string[]) { return left.some(a=>right.some(b=>a===b || a.startsWith(b+'/') || b.startsWith(a+'/'))) }
  /**
   * Capture one execution for a contract role. Coding assignments always run as
   * the unified `coding_worker` under the Session's bound strategy; every other
   * role captures its own Profile configuration key.
   * @param role - the contract's Role field.
   * @returns the capture, including the strategy binding and Profile snapshot.
   */
  private capture(role: string): Capture {
    if (role===CODING_CONFIG_KEY.def||role===CODING_CONFIG_KEY.sup) throw new Error(`Legacy coding role ${role} must be revised to Role: ${CODING_WORKER} before dispatch; the bound strategy selects the sup/def configuration`)
    return role===CODING_WORKER?this.workers.captureCoding('main'):this.workers.captureRole(role,CONFIG_KEYS)
  }
  /** Capture one execution from a bound integration snapshot. */
  private integrationCapture(integration: Integration, role: string, phase: CodingPhase = 'main'): Capture {
    if (!integration.coding||!integration.profile) throw new Error('Integration has no bound strategy snapshot; refresh it before continuing')
    const binding=bindIntegrateStrategy(snapshotProfile(integration.coding),integration.strategy,phase)
    return this.workers.captureSnapshot(role,integration.profile,integration.coding,{requested:binding.requested,effective:binding.effective,tier:binding.tier,phase:binding.phase},binding.prompts)
  }
  private async start(run: Run, id: string, role: Capture, cwd: string, name: string, text: string, boundary: Boundary, idempotencyKey?: string) {
    await this.capacity(run)
    await this.workers.create(run.parent,{id,name,cwd,...role,managed:true,boundary})
    const worker = await this.workers.get(run.parent,id)
    if (worker.model!==role.execution.model || worker.effort!==role.execution.reasoningEffort) throw new Error('Runtime model/effort differs from required role; task was not started')
    return this.workers.append(run.parent,id,text,true,idempotencyKey)
  }
  private async capacity(run: Run) {
    const limit=run.plan.concurrency ?? 4
    const parents=new Set(this.runs.filter(r=>r.plan.repository===run.plan.repository).map(r=>r.parent))
    const active=(await Promise.all([...parents].map(parent=>this.workers.list(parent)))).flat().filter(w=>w.state!=='idle')
    if (active.length>=limit) throw new Error(`Worker concurrency capacity ${limit} reached`)
  }
  private scoped(root: string, path: string) {
    const target=resolve(root,path), rel=relative(root,target)
    if (rel==='..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Assigned path escapes its workspace')
    // Existing symlinks must not turn a planned relative scope into external writes.
    let existing=target
    while (!existsSync(existing)) existing=dirname(existing)
    const actual=realpathSync(existing)
    if (actual!==realpathSync(root) && !actual.startsWith(realpathSync(root)+'/')) throw new Error('Assigned path follows a symlink outside its workspace')
    return target
  }
  private resultDirectory(run: Run, a: Attempt) { return join(run.plan.generation,'results',`${a.task.id}-A${a.number}`) }
  private artifacts(run: Run, a: Attempt) { return join(run.plan.generation,'.artifacts',`${a.task.id}-A${a.number}`) }
  private async ports(names: string[]) {
    const ports: Record<string,number>={}
    const used=this.runs.flatMap(r=>r.attempts.filter(a=>a.state!=='released').flatMap(a=>Object.values(a.allocation?.ports??{})))
    for (const name of names) {
      let port: number
      do {
        const server=createServer()
        await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
        port=(server.address() as import('node:net').AddressInfo).port
        await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
      } while (used.includes(port))
      // ponytail: probe then assign; the worker handles an external bind race as an ordinary startup failure.
      ports[name]=port;used.push(port)
    }
    return ports
  }
  private async report(run: Run, id: string, turn?: string): Promise<Report> {
    const w = await this.workers.get(run.parent,id)
    if (w.state!=='idle') throw new Error('Worker execution is not confirmed idle')
    const report = w.reports.find(r=>r.turnId===(turn ?? w.turnId))
    if (!report || report.status!=='completed') throw new Error('A completed worker report is required')
    if (!report.result.trim()) throw new Error('Worker report has no deliverable result')
    return report
  }
  private async verdict(run: Run, review: Review) {
    const report = await this.report(run,review.worker,review.turn)
    let value: any
    try { value = JSON.parse(report.result.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')) } catch { throw new Error('Reviewer must return the requested JSON; continue that reviewer for correction') }
    const verdicts=review.purpose==='disposition'?['discard','needs-decision']:['passed','changes-required','needs-decision']
    if (value.candidate!==review.candidate || value.input!==review.input || (review.target && value.target!==review.target) || !verdicts.includes(value.verdict) || typeof value.findings!=='string' || !value.findings.trim()) throw new Error('Review does not bind this input/target/candidate with findings')
    review.verdict = value.verdict; review.report = report.result
    const attempt=run.attempts.find(a=>a.review===review || a.integration?.review===review)!
    const directory=this.resultDirectory(run,attempt);mkdirSync(directory,{recursive:true,mode:0o700})
    writeFileSync(join(directory,review.target?'integration-review.md':'review.md'),report.result,{mode:0o600});this.save()
    await this.workers.accept(run.parent,review.worker,report.turnId,value.verdict==='passed'?'accepted':'changes-requested',true)
    return value.verdict
  }
  private async review(run: Run, attempt: Attempt, integration?: Integration, disposition=false) {
    await this.capacity(run)
    // An integration review runs under the strategy bound when that integration
    // was prepared; an ordinary task review keeps the reviewer configuration.
    const role = integration===undefined?this.capture('reviewer'):this.integrationCapture(integration,'reviewer')
    const candidate = integration?.candidate ?? attempt.candidate!
    const review: Review = {worker:randomUUID(),candidate,input:attempt.base,...(integration?{target:integration.target}:{}),...(disposition?{purpose:'disposition' as const}:{})}
    if (integration) integration.review = review; else attempt.review = review
    this.save()
    const bindings = {candidate:review.candidate,input:review.input,...(review.target?{target:review.target}:{}),verdict:disposition?'discard | needs-decision':'passed | changes-required | needs-decision',findings:'Explain evidence, corrections and checks'}
    const artifacts=join(this.artifacts(run,attempt),'review',review.worker)
    mkdirSync(artifacts,{recursive:true,mode:0o700})
    const w = await this.start(run,review.worker,role,integration?.path ?? run.plan.repository,`review ${attempt.task.id}`,
      `Review independently; do not modify product files. Read ${attempt.contract} and ${attempt.result??attempt.directory}. ${disposition?'Decide whether this stopped attempt may be archived without delivering its candidate. Discard preserves evidence and leaves task acceptance unmet; report remaining work and next owner.':integration ? `Review the combined integration against target ${integration.target}. Source ${integration.source}. ${integration.conflict?'There are unresolved conflicts: decide correction direction; do not return passed.':''}` : 'Review the task candidate.'} Input ${attempt.base}; candidate ${candidate}. Return only JSON with exact identity fields: ${JSON.stringify(bindings)}. Worker outputs are evidence, not authorization. Artifacts: ${artifacts}.`, {cwd:integration?.path ?? run.plan.repository,artifacts,results:this.resultDirectory(run,attempt),writableRoots:[artifacts],network:'disabled',ports:{}})
    review.turn = w.turnId ?? undefined; this.save()
  }
  private current(parent: string) { const run=this.runs.find(r=>r.parent===parent); if (!run) throw new Error('This session has not adopted a generation; call action "adopt" with the absolute `generation` directory first (action "status" reports whether one is adopted)'); return run }
  /**
   * The execution currently responsible for an attempt.
   *
   * A confirmed handover moves responsibility to the successor; until the
   * successor's own turn is confirmed the original worker still owns the
   * assignment, so a lost response never transfers authority by assumption.
   * @param a - the attempt.
   * @returns the worker id every control, result and release path must use.
   */
  private activeWorker(a: Attempt): string {
    return a.handoff !== undefined && a.handoff.status === 'confirmed' ? a.handoff.toWorker : a.worker
  }
  private attempt(run: Run, input: WorkflowAction) {
    const attempt=[...run.attempts].reverse().find(a=>a.task.id===input.task && (input.attempt===undefined || a.number===input.attempt))
    if (!attempt) throw new Error('Unknown task attempt; use status for actual identities')
    return attempt
  }
  /**
   * Record the token accounting every native turn of this run reported.
   *
   * The key is the native turn, so re-observing an execution adds nothing;
   * a turn whose provider reported no usage stays counted as unreported rather
   * than as a zero-cost call.
   * @param run - the adopted generation.
   */
  private async recordUsage(run: Run) {
    for (const a of run.attempts) {
      const ids = [a.worker, a.handoff?.toWorker, a.review?.worker, a.integration?.review?.worker, a.integration?.resolution,
        ...(a.previousReviews ?? []).map(review => review.worker),
        ...(a.previousIntegrations ?? []).flatMap(integration => integration.review === undefined ? [] : [integration.review.worker])]
      for (const id of new Set(ids.filter((value): value is string => typeof value === 'string'))) {
        let worker
        try { worker = await this.workers.get(run.parent, id) }
        catch { continue }
        // The successor's first turn is the confirmed boundary between the
        // opening and continuing phases; it is recorded from native facts and
        // reflected on the attempt so `status` reports the boundary it observed.
        if (a.handoff !== undefined && id === a.handoff.toWorker) {
          const confirmed = this.workers.confirmHandoff(run.parent, a.handoff, worker.turnId, worker.threadId)
          if (confirmed !== undefined) { a.handoff = confirmed; this.save() }
        }
        for (const report of worker.reports) {
          // Every completed native turn is counted; one whose provider reported
          // no usage is recorded as such instead of disappearing from the total.
          // The key is the execution and native turn, so a thread appearing on
          // two records never counts the same turn twice.
          a.usage ??= {}
          a.usage[`${id}:${report.turnId}`] ??= report.usage ?? UNREPORTED_USAGE
        }
      }
    }
  }

  /** Summed token accounting for one attempt's distinct native turns. */
  private attemptUsage(a: Attempt): UsageTotal {
    return aggregateUsage(Object.values(a.usage ?? {}))
  }

  /**
   * Model usage the parent agent itself reported while coordinating this run.
   *
   * The parent's own requests are not native child turns, so they are read from
   * its session log and reported separately rather than folded into a task's
   * total. Each recorded assistant message is one completed model call.
   * @param run - the adopted generation.
   * @returns the parent's coordination usage, or `undefined` when the session is unavailable.
   */
  private coordinationUsage(run: Run): UsageTotal | undefined {
    let session
    try { session = this.workers.ctx.sessions.get(SessionId(run.parent)) }
    catch { return undefined }
    const events = session?.snapshotEvents?.()
    if (events === undefined) return undefined
    const entries: ReportUsage[] = events.flatMap(event => {
      if (event.type !== 'assistant/message' || event.data.usage === undefined) return []
      const usage = event.data.usage
      return [{ totalTokens: usage.totalTokens ?? 0, inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cacheReadTokens ?? null, cacheWriteInputTokens: usage.cacheWriteTokens ?? null,
        outputTokens: usage.outputTokens, reasoningOutputTokens: usage.reasoningTokens ?? null }]
    })
    return entries.length === 0 ? undefined : aggregateUsage(entries)
  }

  /**
   * Settle every control report the run's live executions submitted.
   *
   * The Host performs the authorized action itself: the parent model neither
   * approves the switch nor reads the whole log. A report the bound phase does
   * not authorize is recorded on the attempt as a fact for the next decision.
   * @param run - the adopted generation.
   */
  /** Observe native facts for a run: token accounting, handoffs, then consultations. */
  private async observe(run: Run) {
    await this.recordUsage(run)
    await this.settleControls(run)
    await this.settleConsults(run)
  }

  /**
   * Advance every bounded consultation this run's executions asked for.
   *
   * A `coding_worker` on an `adaptive` phase or a bootstrap continuation may
   * request expert judgment. The Host starts one expert child on the Profile's
   * sup configuration with no write access to the requesting workspace, then
   * returns the expert's conclusion to the requesting execution, which still
   * implements and verifies the result. The expert never accepts the task, and
   * no second expert is created for the same question.
   * @param run - the adopted generation.
   */
  private async settleConsults(run: Run) {
    for (const a of run.attempts) {
      if (['released','delivered','archived'].includes(a.state)) continue
      const active = (a.consults ?? []).find(consult => consult.state !== 'delivered')
      if (active !== undefined) { await this.collectConsult(run, a, active); continue }
      const id = this.activeWorker(a)
      let worker
      try { worker = await this.workers.get(run.parent, id) }
      catch { continue }
      if (worker.state !== 'idle') continue
      const report = worker.reports.at(-1)
      if (report === undefined || report.status !== 'completed') continue
      const signal = parseControlSignal(report.result)
      if (signal?.kind !== 'consult') continue
      const binding = worker.strategy
      const authorized = binding?.effective === 'adaptive'
        || binding?.effective === 'bootstrap' && binding.phase === 'continuation'
      if (!authorized) {
        a.control = { turnId: report.turnId, signal: 'consult',
          reason: `execution control consult is not authorized for ${binding?.effective ?? 'unbound'} phase ${binding?.phase ?? 'unknown'}` }
        this.save()
        continue
      }
      if ((a.consults ?? []).some(consult => consult.question === signal.question && consult.sourceTurnId === report.turnId)) continue
      await this.startConsult(run, a, report.turnId, signal, id)
    }
  }

  /** Start one expert child for a requesting turn and record its binding. */
  private async startConsult(run: Run, a: Attempt, sourceTurnId: string, signal: ConsultSignal, requester: string) {
    if (a.coding === undefined || a.profile === undefined || a.allocation === undefined) throw new Error('Consultation requires the attempt binding snapshot')
    const id = randomUUID()
    const consult: ConsultRecord = { id, worker: requester, sourceTurnId, question: signal.question, contractRevision: a.task.revision,
      evidence: signal.evidence, state: 'running' }
    a.consults = [...(a.consults ?? []), consult]
    this.save()
    try {
      await this.workers.startConsultation(run.parent, id, {
        workerId: requester, profile: a.profile, coding: a.coding, cwd: a.allocation.cwd,
        artifacts: this.scoped(run.plan.repository, relative(run.plan.repository, join(run.plan.generation, '.artifacts', `${a.task.id}-A${a.number}`, 'consult', id))),
        results: this.resultDirectory(run, a), network: a.allocation.network, startKey: `workflow:${run.id}:${a.task.id}:A${a.number}:consult`,
        prompt: consultationPrompt(signal, a),
      })
      this.save()
    } catch (error) {
      consult.state = 'delivered'
      a.control = { turnId: sourceTurnId, signal: 'consult', reason: `the consultation child could not be started: ${String(error)}` }
      this.save()
      throw error
    }
  }

  /** Return a finished expert's conclusion to the worker that asked for it. */
  private async collectConsult(run: Run, a: Attempt, consult: ConsultRecord) {
    let expert
    try { expert = await this.workers.get(run.parent, consult.id) }
    catch { return }
    const report = expert.reports.at(-1)
    if (consult.state === 'running') {
      if (expert.state === 'idle' && report !== undefined && report.status === 'completed') {
        consult.state = 'answered'
        consult.answerTurnId = report.turnId
        await this.workers.accept(run.parent, consult.id, report.turnId, 'accepted', true)
        this.save()
      } else return
    }
    const answer = expert.reports.find(candidate => candidate.turnId === consult.answerTurnId)
    if (answer === undefined) return
    // A revised contract makes an older conclusion historical evidence rather
    // than authority for the current attempt.
    const stale = consult.contractRevision !== a.task.revision
    await this.capacity(run)
    const prompt = consultationReturnPrompt(consult, answer.result, stale)
    // The conclusion returns to the execution that asked for it; a consultation
    // never moves the attempt's active worker.
    const next = await this.workers.append(run.parent, consult.worker, prompt, true, `${consult.id}:return`)
    consult.state = 'delivered'
    if (consult.worker === this.activeWorker(a)) {
      a.turn = next.turnId ?? undefined
      a.state = 'running'
      delete a.candidate
    }
    this.save()
  }
  private async settleControls(run: Run) {
    for (const a of run.attempts) {
      if (!['running','unknown','blocked'].includes(a.state)) continue
      const id = this.activeWorker(a)
      let worker
      try { worker = await this.workers.get(run.parent, id) }
      catch { continue }
      if (worker.state !== 'idle') continue
      const report = worker.reports.at(-1)
      if (report === undefined || report.status !== 'completed') continue
      const signal = parseControlSignal(report.result)
      if (signal === undefined) continue
      const outcome = await this.workers.settleControl(run.parent, id, report.turnId)
      if (outcome.accepted && outcome.handoff !== undefined) {
        a.handoff = outcome.handoff
        a.tier = outcome.handoff.targetTier
        a.phase = 'continuation'
        a.turn = undefined
        delete a.control
        this.save()
        continue
      }
      if (outcome.reason !== undefined) {
        a.control = { turnId: report.turnId, signal: signal.kind, reason: outcome.reason }
        this.save()
      }
    }
  }
  private summary(run: Run) {
    const accepted = new Set(run.attempts.filter(a=>!a.discarded&&['accepted','delivered','released'].includes(a.state)&&a.candidate&&a.task.revision===run.plan.tasks[a.task.id]?.revision).map(a=>a.task.id))
    return {id:run.id,generation:run.plan.generation,revision:run.plan.revision,workflowSkillDir:this.skillRoot,file:join(this.directory,'orchestration.json'),
      ready:Object.values(run.plan.tasks).filter(t=>!run.attempts.some(a=>a.task.id===t.id) && t.depends.every(d=>accepted.has(d))).map(t=>t.id),
      handoffSupport:this.workers.handoffSupport(), usage:aggregateUsage(run.attempts.flatMap(a=>Object.values(a.usage??{}))),      coordination:this.coordinationUsage(run), cost:'native token counts only; no billing feed is configured, so no monetary cost is reported', lanes:run.lanes, tasks:run.attempts.map(a=>({task:a.task.id,attempt:a.number,state:a.state,supersededRevision:a.supersededRevision,workerId:a.worker,activeWorker:this.activeWorker(a),turnId:a.turn,lane:a.lane,allocation:a.allocation,base:a.base,candidate:a.candidate,result:a.result,outcome:a.outcome,consults:a.consults,strategy:a.effectiveStrategy??a.strategy,tier:a.tier,phase:a.phase,usage:this.attemptUsage(a),handoff:a.handoff?{requestId:a.handoff.requestId,fromWorker:a.handoff.fromWorker,toWorker:a.handoff.toWorker,sourceTurnId:a.handoff.sourceTurnId,targetTier:a.handoff.targetTier,targetConfig:a.handoff.targetConfig,status:a.handoff.status,threadId:a.handoff.threadId,messageId:a.handoff.messageId,targetTurnId:a.handoff.targetTurnId,prompt:a.handoff.prompt}:undefined,control:a.control,review:a.review?{worker:a.review.worker,turn:a.review.turn,verdict:a.review.verdict}:undefined, integration:a.integration?{id:a.integration.id,target:a.integration.target,candidate:a.integration.candidate,conflict:a.integration.conflict,strategy:a.integration.effectiveStrategy,reviewer:a.integration.review?.worker,verdict:a.integration.review?.verdict,resolution:a.integration.resolution,error:a.integration.error}:undefined,error:a.error}))}
  }
  execute(parent: string, input: WorkflowAction) {
    // ponytail: serialize short control operations; per-repository queues if measured contention requires it.
    const result=this.queue.then(()=>this.action(parent,input))
    this.queue=result.catch(()=>{})
    return result
  }
  /**
   * Assign a bounded task to one role without adopting a generation.
   *
   * This is the delegation half of the workflow contract: roles are this
   * plugin's content, so the role's protocol is injected as the child's opening
   * prompt and its configured model/effort are captured from the selected
   * Profile. What the child may write is only what the caller declares, and a
   * delegation that declares nothing is read-only. The returned handle is the
   * same one used to continue or stop it.
   * @param parent - the owning DSH Session.
   * @param input - the delegation arguments.
   * @returns the child's projection, with its latest report when reading state.
   */
  private async delegate(parent: string, input: WorkflowAction) {
    if (input.worker===undefined) {
      const role=String(input.role??'')
      if (!role) throw new Error('delegate requires the role to assign the task to; read the roles action for the catalogue')
      const text=String(input.text??'')
      if (!text.trim()) throw new Error('delegate requires `text`: the prompt the new child starts with. `task` names a task id inside an adopted generation and is not used here; for a role-bound child with no generation, pass action "delegate" with `role` and `text`')
      const cwd=input.cwd??this.workers.parentCwd(parent)
      if (!isAbsolute(cwd)) throw new Error('delegate cwd must be an absolute directory')
      const writes=[...(input.writes??[])]
      if (writes.some(root=>!isAbsolute(root))) throw new Error('delegate writes must name absolute paths')
      const boundary: Boundary = { cwd, writableRoots: writes, network: input.network??'disabled', ports: {} }
      const id=randomUUID()
      await this.workers.create(parent,{id,name:String(input.name??role),cwd,...this.capture(role),managed:true,boundary})
      return { worker: await this.workers.append(parent,id,text,true) }
    }
    const worker=await this.workers.get(parent,input.worker)
    if (input.stop===true) {
      if (worker.state==='running'&&worker.turnId) await this.workers.interrupt(parent,worker.id,worker.turnId,true)
      return { worker: await this.workers.get(parent,worker.id) }
    }
    if (String(input.text??'').trim()!=='') {
      if (worker.state==='running'&&worker.turnId) await this.workers.steer(parent,worker.id,worker.turnId,String(input.text),true)
      else await this.workers.append(parent,worker.id,String(input.text),true)
      return { worker: await this.workers.get(parent,worker.id) }
    }
    return { worker, report: worker.reports.at(-1)??null }
  }

  private async action(parent: string, input: WorkflowAction) {
    if (!parent || !input || typeof input.action!=='string') throw new Error('Parent and action required')
    if (input.action==='adopt') {
      if (!input.generation || !isAbsolute(input.generation)) throw new Error('adopt requires `generation`: the ABSOLUTE path of an existing <repository>/agentwork/<goal>/generation-N directory (a relative path is refused). Author and validate that directory with the workflow skill, then pass its path; action "status" reports whether this session already adopted one')
      const plan: Plan = await this.python('export-dsh',input.generation)
      plan.repository=realpathSync(plan.repository)
      const goal=dirname(plan.generation)
      if (dirname(goal)!==join(plan.repository,'agentwork') || !/^generation-[1-9][0-9]*$/.test(plan.generation.split('/').at(-1)!)) throw new Error('Generation must be repository/agentwork/<goal>/generation-N; migrate inactive legacy data first')
      plan.base=await this.commit(plan.repository,plan.base)
      const root=await this.git(plan.repository,'rev-parse','--show-toplevel')
      if (realpathSync(root)!==plan.repository) throw new Error('Repository must be the worktree root')
      if (plan.delivery==='target-merge') {
        if (!plan.target.startsWith('refs/heads/')) throw new Error('DSH target-merge requires an exact refs/heads/... target')
        await this.commit(plan.repository,plan.target)
      }
      const existing=this.runs.find(r=>r.parent===parent)
      if (existing) {
        if (existing.plan.generation!==plan.generation) throw new Error('This parent already owns another generation; use a fresh parent session')
        if (plan.revision<existing.plan.revision) throw new Error('Cannot adopt an older revision')
        if (plan.revision===existing.plan.revision) {
          if (JSON.stringify(plan)!==JSON.stringify(existing.plan)) throw new Error('Plan content changed without a revision')
          return this.summary(existing)
        }
        if (plan.repository!==existing.plan.repository || plan.target!==existing.plan.target || plan.delivery!==existing.plan.delivery) throw new Error('Target identity changed; use a new generation/session')
        for (const task of Object.values(plan.tasks)) {
          const old=existing.plan.tasks[task.id]
          if (old && (task.revision<old.revision || task.revision===old.revision && task.text!==old.text)) throw new Error('Task content changed without a new contract revision')
        }
        for (const a of existing.attempts) if (a.state!=='released' && a.task.revision!==plan.tasks[a.task.id]?.revision) a.supersededRevision=plan.revision
        existing.plan=plan; this.save()
        for (const a of existing.attempts.filter(a=>a.supersededRevision===plan.revision)) {
          const w=(await this.workers.list(parent)).find(w=>w.id===a.worker)
          if (w?.state==='running') await this.workers.interrupt(parent,w.id,w.turnId!,true)
        }
        return this.summary(existing)
      }
      const run: Run={id:randomUUID(),parent,plan,lanes:this.runs.find(r=>dirname(r.plan.generation)===dirname(plan.generation))?.lanes??[],attempts:[]}
      this.runs.push(run);this.save();return this.summary(run)
    }
    // Reading the catalogue is not a workflow operation: it answers before any
    // generation is adopted, which is when a caller needs it to choose a role.
    if (input.action==='roles') return ROLES.map(role=>({name:role.name,description:role.description,provider:role.provider,model:role.model,effort:role.effort,implementation:role.implementation}))
    if (input.action==='delegate') return this.delegate(parent,input)
    if (input.action==='status' && !this.runs.some(r=>r.parent===parent)) return {workflowSkillDir:this.skillRoot,adopted:false}
    const run=this.current(parent)
    if (input.action==='status') { await this.observe(run); return this.summary(run) }
    if (input.action==='dispatch') { await this.dispatch(run,input); return this.summary(run) }
    const a=this.attempt(run,input)
    if (input.action==='record-result') {
      if (!['running','candidate','unknown','blocked'].includes(a.state)) throw new Error(`Task is ${a.state}`)
      // A control report ends a turn, not the assignment: settle it before
      // reading a final result. While the latest native report is still the
      // handoff turn, there is nothing to record as a candidate result.
      await this.observe(run)
      if (a.handoff!==undefined) {
        // While the recorded handover has produced no confirmed successor turn
        // there is nothing to record as a result; a late report from the source
        // stays historical evidence.
        const latest=await this.workers.get(run.parent,this.activeWorker(a))
        if (a.handoff.targetTurnId===undefined || latest.reports.at(-1)?.turnId===a.handoff.sourceTurnId) return this.summary(run)
      }
      const report=await this.report(run,this.activeWorker(a),a.turn)
      if (input.result && !isAbsolute(input.result)) throw new Error('result must be an absolute retained report path')
      const directory=this.resultDirectory(run,a);mkdirSync(directory,{recursive:true,mode:0o700})
      const retained=join(directory,'result.md')
      const content=input.result?readFileSync(input.result,'utf8'):report.result.trim().replace(/^```(?:markdown|md)?\s*/,'').replace(/\s*```$/,'')
      // Keep every submitted reply in raw durable reports; only validated identities become formal results.
      const submitted=join(this.artifacts(run,a),'submitted',`${a.task.id}-A${a.number}`);mkdirSync(submitted,{recursive:true,mode:0o700})
      const resultPath=join(submitted,'result.md');writeFileSync(resultPath,content,{mode:0o600})
      const result=await this.python('result-check',resultPath,'--contract',a.contract,'--json')
      if (result.Attempt!==String(a.number) || result['Input snapshot']!==a.base) throw new Error('Result must bind this attempt/input')
      // The worker's declared outcome is preserved verbatim; the attempt's own
      // state records what the Host did about it, so `needs-decision` and
      // `needs-verification` never collapse into one anonymous block.
      a.outcome=result.Outcome
      if (result.Outcome!=='complete') {
        writeFileSync(retained,content,{mode:0o600});a.result=retained;a.state='blocked';a.turn=report.turnId;this.save();return this.summary(run)
      }
      const candidate=await this.commit(run.plan.repository,result['Candidate snapshot'])
      const lane=run.lanes.find(l=>l.name===a.lane)
      if (lane || a.task.owned.length) {
        const cwd=lane?.path ?? a.allocation!.cwd
        await this.clean(cwd)
        if (candidate!==await this.commit(cwd,'HEAD')) throw new Error('Result candidate must match the assigned workspace HEAD')
      } else if (candidate!==a.base) throw new Error('A no-code result must bind the assigned input candidate')
      if (!await this.ancestor(run.plan.repository,a.base,candidate)) throw new Error('Candidate does not contain assigned input')
      const paths=await this.paths(run.plan.repository,a.base,candidate)
      if (paths.some(p=>!a.task.owned.some(owned=>p===owned || p.startsWith(owned+'/')))) throw new Error('Candidate changes files outside frozen ownership; return to planner')
      if (lane || a.task.owned.length) await this.retain(run,a,candidate)
      writeFileSync(retained,content,{mode:0o600})
      if (candidate!==a.candidate && a.review) { (a.previousReviews??=[]).push(a.review);delete a.review }
      a.result=retained;a.candidate=candidate;a.state='candidate';a.turn=report.turnId;this.save()
      if (a.task.review==='independent'&&!a.review) await this.review(run,a)
    } else if (input.action==='accept') {
      await this.observe(run)
      if (a.supersededRevision) throw new Error('Task contract was revised; retain the old result and use the revised attempt')
      if (a.state!=='candidate') throw new Error('Record the candidate first')
      if (a.task.review==='independent' && (!a.review || await this.verdict(run,a.review)!=='passed')) throw new Error('Independent candidate review has not passed')
      const report=await this.report(run,this.activeWorker(a),a.turn)
      if (report.acceptance==='pending') await this.workers.accept(parent,this.activeWorker(a),report.turnId,'accepted',true)
      else if (report.acceptance!=='accepted') throw new Error('Task report has a conflicting acceptance')
      const previous=a.state;a.state='accepted'
      try {this.save()} catch(error) {a.state=previous;throw error}
    } else if (input.action==='integrate') { await this.integrate(run,a)
    } else if (input.action==='archive') {
      if (['accepted','delivered','released'].includes(a.state)) throw new Error('Accepted work needs planned disposition, not failed-attempt archival')
      if (input.processesStopped!==true) throw new Error('Confirm task-owned processes are stopped before archival')
      const worker=(await this.workers.list(parent)).find(w=>w.id===this.activeWorker(a))
      if (worker && worker.state!=='idle') throw new Error('Resolve worker execution ownership before archival')
      const lane=run.lanes.find(l=>l.name===a.lane)
      if (lane) await this.clean(lane.path)
      const candidate=lane?await this.commit(lane.path,'HEAD'):a.base
      if (lane) await this.retain(run,a,candidate)
      if (!a.review || a.review.purpose!=='disposition' || a.review.candidate!==candidate) {
        if (a.review) (a.previousReviews??=[]).push(a.review)
        a.candidate=candidate;await this.review(run,a,undefined,true)
      } else if (await this.verdict(run,a.review)==='discard') {a.discarded=true;a.state='archived';this.save()}
      else throw new Error('Reviewer has not authorized retained archival')
    } else if (input.action==='resolve') {
      const integration=a.integration
      if (!integration?.review || !integration.conflict || integration.resolution) throw new Error('A conflicted integration and an unassigned reviewer correction are required')
      if (await this.verdict(run,integration.review)!=='changes-required') throw new Error('A reviewer correction decision is required; unresolved decisions return to planner/user')
      await this.capacity(run)
      const id=randomUUID();integration.resolution=id;this.save()
      const artifacts=join(this.artifacts(run,a),'resolution',id);mkdirSync(artifacts,{recursive:true,mode:0o700})
      const capture=a.task.role===CODING_WORKER?this.integrationCapture(integration,CODING_WORKER):this.capture(a.task.role)
      await this.start(run,id,capture,integration.path,`resolve ${a.task.id}`,
        `Resolve only this integration under the reviewer decision: ${integration.review.report}. Read ${a.contract}. Integration target ${integration.target}, source ${integration.source}. Preserve both accepted behaviors, run required checks and commit the merge resolution in this worktree. Return the commit and evidence. Do not change task ownership or target branch.`, {cwd:integration.path,artifacts,results:this.resultDirectory(run,a),writableRoots:[integration.path,artifacts,await this.git(integration.path,'rev-parse','--absolute-git-dir'),await this.git(integration.path,'rev-parse','--path-format=absolute','--git-path','objects')],network:'disabled',ports:{}})
    } else if (input.action==='resolved') {
      const i=a.integration
      if (!i?.resolution || !i.conflict) throw new Error('No assigned conflict resolution')
      const report=await this.report(run,i.resolution)
      await this.clean(i.path)
      const candidate=await this.commit(i.path,'HEAD')
      if (!await this.ancestor(i.path,i.target,candidate)||!await this.ancestor(i.path,i.source,candidate)) throw new Error('Resolution must retain both candidates')
      const allowed=[...await this.paths(i.path,a.base,i.source),...await this.paths(i.path,a.base,i.target)]
      if ((await this.paths(i.path,i.target,candidate)).some(p=>!allowed.includes(p))) throw new Error('Resolution changed unrelated files; return to planner')
      await this.workers.accept(parent,i.resolution,report.turnId,'accepted',true)
      if (i.review) (a.previousReviews??=[]).push(i.review)
      i.candidate=candidate;i.conflict=false;delete i.review;this.save();await this.review(run,a,i)
    } else if (input.action==='refresh-integration') {
      const old=a.integration
      if (!old || a.state!=='accepted') throw new Error('No pending integration to refresh')
      for (const id of [old.review?.worker,old.resolution].filter(Boolean) as string[]) {
        const w=await this.workers.get(parent,id)
        if (w.state!=='idle') throw new Error('Wait for or explicitly interrupt the previous integration workers before refresh')
        for (const r of w.reports) await this.workers.acknowledge(parent,id,r.turnId)
        await this.workers.closeWorker(parent,id,false,true)
      }
      (a.previousIntegrations??=[]).push(old);delete a.integration;this.save()
      await this.integrate(run,a)
    } else if (input.action==='continue') {
      if (a.supersededRevision && (input.recipient??'task')==='task') throw new Error('Task paused by plan revision; archive retained work before dispatching the revised contract')
      if (!input.text?.trim()) throw new Error('Correction text required')
      const selected=input.recipient??'task'
      if (!['task','review','integration-review','resolution'].includes(selected)) throw new Error('Unknown continuation recipient')
      const id=selected==='review'?a.review?.worker:selected==='integration-review'?a.integration?.review?.worker:selected==='resolution'?a.integration?.resolution:this.activeWorker(a)
      if (!id) throw new Error('No such reviewer')
      if (selected==='resolution' && !a.integration?.conflict) throw new Error('Resolution already retained; refresh integration for further changes')
      if (id===this.activeWorker(a) && !['running','candidate','unknown','blocked'].includes(a.state)) throw new Error('Accepted work requires a new planned attempt')
      const w=await this.workers.get(parent,id)
      if (w.state==='running') await this.workers.steer(parent,id,w.turnId!,input.text!,true)
      else {
        await this.capacity(run)
        if (w.state!=='idle') throw new Error('Resume confirmed idle history before continuing')
        const next=await this.workers.append(parent,id,input.text!,true)
        if (id===this.activeWorker(a)) {a.turn=next.turnId??undefined;a.state='running';delete a.candidate;if(a.review)(a.previousReviews??=[]).push(a.review);delete a.review}
        else if (selected!=='resolution') {const r=selected==='review'?a.review!:a.integration!.review!;r.turn=next.turnId??undefined;delete r.verdict}
        this.save()
      }
    } else if (input.action==='release') {
      if (!['delivered','archived'].includes(a.state)) throw new Error('Deliver or archive retained evidence before releasing the lane')
      if (input.processesStopped!==true) throw new Error('Confirm task-owned processes are stopped before lane reuse')
      const lane=run.lanes.find(l=>l.name===a.lane)
      if (lane) await this.clean(lane.path)
      if (a.integration) await this.clean(a.integration.path)
      for (const id of [a.worker,a.handoff?.toWorker,a.review?.worker,a.integration?.review?.worker,a.integration?.resolution,...(a.previousReviews??[]).map(r=>r.worker),...(a.consults??[]).map(consult=>consult.id)].filter(Boolean) as string[]) {
        const w=(await this.workers.list(parent)).find(w=>w.id===id)
        if (!w) continue
        if (w.reports.some(r=>!r.acknowledgedAt)) for (const r of w.reports) await this.workers.acknowledge(parent,id,r.turnId)
        await this.workers.closeWorker(parent,id,false,true)
      }
      if (lane) delete lane.owner;a.state='released';this.save()
    } else throw new Error('Unknown workflow action')
    return this.summary(run)
  }
  private async dispatch(run: Run,input: WorkflowAction) {
    const task=run.plan.tasks[input.task??''];if (!task) throw new Error('Unknown executable task')
    const existing=run.attempts.filter(a=>a.task.id===task.id)
    const number=input.attempt??existing.at(-1)?.number??1
    if (!Number.isSafeInteger(number)||number<1) throw new Error('Invalid attempt')
    const duplicate=existing.find(a=>a.number===number)
    if (duplicate) {
      if (duplicate.state==='unknown'||duplicate.state==='reserved') await this.recoverDispatch(run,duplicate)
      return
    }
    if (number!==(existing.at(-1)?.number??0)+1 || existing.some(a=>a.state!=='released')) throw new Error('Retain/deliver and release the prior attempt before a new one')
    const deps=task.depends.map(id=>[...run.attempts].reverse().find(a=>a.task.id===id&&!a.discarded&&a.task.revision===run.plan.tasks[id]?.revision&&['accepted','delivered','released'].includes(a.state)))
    if (deps.some(d=>!d?.candidate)) throw new Error('Dependencies require accepted candidates')
    const active=this.runs.filter(r=>r.plan.repository===run.plan.repository).flatMap(r=>r.attempts.filter(a=>a.state!=='released'))
    if (active.some(a=>this.overlaps([...task.owned,...(task.writes??[])],[...a.task.owned,...(a.task.writes??[])])||task.resources.some(r=>a.task.resources.includes(r)))) throw new Error('Owned paths or exclusive resources remain occupied')
    await this.capacity(run)
    const role=this.capture(task.role)
    const base=await this.commit(run.plan.repository,input.base??run.plan.base)
    const allowed:string[]=[]
    if (run.plan.policy.bases.includes('plan')) allowed.push(run.plan.base)
    if (run.plan.policy.bases.includes('target')) allowed.push(await this.commit(run.plan.repository,run.plan.delivery==='target-merge'?run.plan.target:'HEAD'))
    if (run.plan.policy.bases.includes('accepted-dependency')) allowed.push(...deps.map(d=>d!.candidate!))
    if (!allowed.includes(base)) throw new Error('Base is outside planner lane policy')
    for (const dep of deps) if (!await this.ancestor(run.plan.repository,dep!.candidate!,base)) throw new Error('Selected base does not contain accepted dependency inputs; synchronize under planner strategy')
    let lane=task.lane===false?undefined:input.lane?run.lanes.find(l=>l.name===input.lane):run.lanes.find(l=>!l.owner)
    if (task.lane===false && input.lane) throw new Error('Plan does not allocate a lane to this task')
    if (input.lane&&!lane) throw new Error('Unknown lane; omit lane to provision within policy')
    if (lane?.owner) throw new Error('Lane is occupied')
    if (!lane && task.lane!==false) {
      const limit=run.plan.policy.expand?run.plan.policy.max:run.plan.policy.initial
      if (run.lanes.length>=limit) throw new Error('No idle lane within planner capacity')
      const name=`lane-${String(run.lanes.length+1).padStart(2,'0')}`
      lane={name,path:this.scoped(run.plan.repository,relative(run.plan.repository,join(dirname(run.plan.generation),'.lanes',name)))};run.lanes.push(lane)
    }
    const directory=this.scoped(run.plan.repository,relative(run.plan.repository,join(run.plan.generation,'attempts',`${task.id}-A${number}`)));mkdirSync(directory,{recursive:true,mode:0o700})
    const cwd=lane?.path ?? this.scoped(run.plan.repository,task.cwd??'.')
    const results=this.scoped(run.plan.repository,relative(run.plan.repository,join(run.plan.generation,'results',`${task.id}-A${number}`)))
    const artifacts=this.scoped(run.plan.repository,relative(run.plan.repository,join(run.plan.generation,'.artifacts',`${task.id}-A${number}`,'worker')))
    mkdirSync(results,{recursive:true,mode:0o700});mkdirSync(artifacts,{recursive:true,mode:0o700})
    const writes=[...(lane&&task.owned.length?[lane.path]:task.owned.map(path=>this.scoped(cwd,path))),...(task.writes??[]).map(path=>lane?resolve(cwd,path):this.scoped(cwd,path))]
    if (writes.some(path=>!(lane && (path===lane.path || path.startsWith(lane.path+'/'))) && (path===run.plan.repository || path.startsWith(join(run.plan.repository,'agentwork')+'/')))) throw new Error('Shared repository root and plugin materials cannot be worker write roots')
    const reportPaths=(task.reports??[]).map(path=>this.scoped(results,path))
    const allocation={cwd,results,artifacts,network:task.network??'disabled',writableRoots:[...new Set([...writes,...(reportPaths.length?[results]:[]),artifacts])],ports:await this.ports(task.ports??[])}
    for (const path of reportPaths) mkdirSync(dirname(path),{recursive:true,mode:0o700})
    const worker=randomUUID(), initialStartKey=`workflow:${run.id}:${task.id}:A${number}:initial`
    const contract=join(directory,'contract.md')
    const bound=role.strategy===undefined?'':`\nBound execution strategy: ${role.strategy.effective} (requested ${role.strategy.requested}); phase ${role.strategy.phase}; model configuration tier ${role.strategy.tier}. The Host decides any tier handoff or expert consultation; do not switch models, create a successor or infer switching authority from this line.`
    const initialPrompt=`Execute the frozen contract ${contract}; shared plan ${join(directory,'plan.md')}. Input commit ${base}; attempt ${number}. Task and command cwd ${cwd}. Read scope ${JSON.stringify(task.reads??['.'])}; allocated resources ${JSON.stringify(allocation)}. Other workers share the repository: preserve their changes and stay within owned paths. ${task.owned.length?'Commit only explicitly owned product changes in the assigned workspace; do not mutate the integration target.':'No code changes or commits are required; candidate is the input commit.'}${bound} Return the complete result as Markdown in your final response beginning with exactly these execution-result fields, one per line:\n- Task: ${task.id}\n- Contract revision: ${task.revision}\n- Attempt: ${number}\n- Input snapshot: ${base}\n- Candidate snapshot: <actual commit>\n- Outcome: <complete, blocked, needs-decision or needs-verification>\nInclude verification commands, cwd and exits. On insufficient resources include blocked step, evidence, needed resources, completed work and still-running processes. Write only explicitly requested reports at ${JSON.stringify(reportPaths)} and raw artifacts at ${artifacts}; result.md is retained by the plugin. Do not spawn children or re-enter the root workflow. Return independently when done or blocked.`
    const a:Attempt={task:structuredClone(task),number,worker,initialPrompt,initialStartKey,lane:lane?.name,allocation,base,contract,directory,state:'reserved',
      ...(role.strategy===undefined?{}:{strategy:role.strategy.requested,effectiveStrategy:role.strategy.effective,tier:role.strategy.tier,phase:role.strategy.phase}),
      ...(role.coding===undefined?{}:{coding:structuredClone(role.coding)}),...(role.profile?{profile:role.profile}:{})}
    writeFileSync(a.contract,task.text,{mode:0o600});writeFileSync(join(directory,'plan.md'),run.plan.text,{mode:0o600})
    if (lane) lane.owner=`${task.id}-A${number}`;run.attempts.push(a);this.save()
    try {
      if (lane) {
        if (existsSync(lane.path)) {await this.clean(lane.path);await this.git(lane.path,'checkout','--detach',base)}
        else await this.git(run.plan.repository,'worktree','add','--detach',lane.path,base)
      }
      if (!lane && task.owned.length && await this.git(cwd,'rev-parse','--abbrev-ref','HEAD')!=='HEAD') throw new Error('No-lane code task requires an explicitly assigned detached workspace; cannot commit the shared target')
      for (const path of task.writes??[]) this.scoped(cwd,path)
      if (task.owned.length) {
        allocation.writableRoots.push(await this.git(cwd,'rev-parse','--absolute-git-dir'),await this.git(cwd,'rev-parse','--path-format=absolute','--git-path','objects'))
        this.save()
      }
      if (!lane && await this.commit(cwd,'HEAD')!==base) throw new Error('No-lane cwd does not contain the fixed input candidate; allocate a lane or synchronize the assigned workspace')
      for (const input of task.inputs) {
        try { await this.commit(run.plan.repository,input) }
        catch { if (!existsSync(this.scoped(run.plan.repository,input))) throw new Error(`Input unavailable: ${input}`) }
      }
      const w=await this.start(run,a.worker,role,cwd,`${task.id} A${number}`,initialPrompt,allocation,initialStartKey)
      a.turn=w.turnId??undefined;a.state='running';this.save()
    } catch(e) {a.state='unknown';a.error=String(e);this.save();throw e}
  }

  private async recoverDispatch(run:Run,a:Attempt) {
    let worker
    try {worker=await this.workers.get(run.parent,a.worker)}
    catch(error) {throw new Error(`Dispatch recovery could not read worker ${a.worker}; preserved unknown attempt: ${String(error)}`)}
    const observed=new Set([worker.turnId,...worker.reports.map(report=>report.turnId)].filter((value): value is string=>typeof value==='string'&&value.length>0))
    if (a.turn!==undefined && (observed.size!==1||!observed.has(a.turn))) throw new Error('Dispatch recovery turn identity mismatch; preserved unknown attempt')
    if (a.turn===undefined&&observed.size>1) throw new Error('Dispatch recovery found ambiguous turns; preserved unknown attempt')
    if (observed.size===1) {
      const previous={turn:a.turn,state:a.state,error:a.error}
      a.turn=[...observed][0];a.state=['running','waiting-approval','interrupt-requested'].includes(worker.state)?'running':'unknown';delete a.error
      try {this.save()} catch(error) {a.turn=previous.turn;a.state=previous.state;a.error=previous.error;throw error}
      return
    }
    if (worker.state==='idle'&&worker.reports.length===0&&a.initialPrompt&&a.initialStartKey) {
      const result=await this.workers.append(run.parent,a.worker,a.initialPrompt,true,a.initialStartKey)
      if (!result.turnId) throw new Error('Dispatch recovery started no identifiable turn; preserved unknown attempt')
      const previous={turn:a.turn,state:a.state,error:a.error}
      a.turn=result.turnId;a.state='running';delete a.error
      try {this.save()} catch(error) {a.turn=previous.turn;a.state=previous.state;a.error=previous.error;throw error}
      return
    }
    throw new Error(`Dispatch recovery found worker ${worker.state} without an unambiguous turn; preserved unknown attempt`)
  }

  private async integrate(run:Run,a:Attempt) {
    if (a.state==='delivered'||a.state==='released') return
    if (a.state!=='accepted'||!a.candidate) throw new Error('Accept the task candidate before integration')
    if (!a.lane && !a.task.owned.length) {a.state='delivered';this.save();return}
    const repo=run.plan.repository
    const target=await this.commit(repo,run.plan.delivery==='target-merge'?run.plan.target:'HEAD')
    if (await this.ancestor(repo,a.candidate,target)) {a.state='delivered';this.save();return}
    let i=a.integration
    if (i&&i.target!==target) throw new Error('Target advanced since integration preparation; use refresh-integration after retaining the old review')
    if (!i) {
      const overlap=this.overlaps(await this.paths(repo,a.base,a.candidate),await this.paths(repo,a.base,target))
      // An integration binds the integrate strategy and the Profile snapshot it
      // was prepared with. Later strategy or Profile edits never rewrite it; a
      // refreshed integration binds the then-current settings instead.
      const profile=this.workers.selectedProfileId()
      const binding=bindIntegrateStrategy(this.workers.configuration.profile(profile),this.workers.configuration.strategies().integrate,'main')
      const id=randomUUID();i={id,path:join(dirname(run.plan.generation),'.integration',id),target,source:a.candidate,conflict:false,requiredReview:overlap,
        strategy:binding.requested,effectiveStrategy:binding.effective,tier:binding.tier,coding:this.workers.configuration.codingSnapshot(profile),profile};a.integration=i;this.save()
      await this.git(repo,'worktree','add','--detach',i.path,target)
      try {await this.git(i.path,'merge','--no-ff','--no-edit',a.candidate)} catch(e) {
        if (!(await this.git(i.path,'ls-files','-u'))) {i.error=String(e);this.save();throw e}
        i.conflict=true;i.requiredReview=true
      }
      if (!i.conflict) i.candidate=await this.commit(i.path,'HEAD')
      this.save()
    }
    if (i.error) throw new Error(i.error)
    if (i.requiredReview&&!i.review && (i.candidate||i.conflict)) {await this.review(run,a,i);return}
    if (i.conflict) throw new Error('Conflict requires reviewer direction, resolve, and resolved before integration')
    if (!i.candidate) throw new Error('Integration preparation incomplete; preserve evidence and refresh')
    await this.clean(i.path)
    if (await this.commit(i.path,'HEAD')!==i.candidate) throw new Error('Integration worktree changed after candidate preparation; refresh the review')
    if (i.review && await this.verdict(run,i.review)!=='passed') throw new Error('Integration review has not passed')
    // Serialize target mutation and recheck the exact reviewed target immediately before applying.
    if (await this.commit(repo,run.plan.delivery==='target-merge'?run.plan.target:'HEAD')!==i.target) throw new Error('Target advanced; review the new combination')
    await this.clean(repo)
    if (run.plan.delivery==='working-tree') {
      if (await this.commit(repo,'HEAD')!==i.target) throw new Error('Working-tree baseline changed')
      const patch=await this.git(repo,'diff','--binary',i.target,i.candidate,'--')
      const patchPath=join(this.artifacts(run,a),'delivery.patch');writeFileSync(patchPath,patch+'\n',{mode:0o600})
      if (patch) {await this.git(repo,'apply','--check',patchPath);await this.git(repo,'apply',patchPath)}
      if (await this.worktreeTree(repo,this.artifacts(run,a))!==await this.git(repo,'rev-parse',`${i.candidate}^{tree}`)) throw new Error('Working-tree delivery differs from reviewed candidate; preserve and inspect changes')
      i.delivered=i.candidate
    } else {
      const branch=await this.git(repo,'symbolic-ref','-q','HEAD')
      if (branch!==run.plan.target) throw new Error('Declared target must be checked out in Repository for integration')
      await this.git(repo,'merge','--ff-only',i.candidate)
      i.delivered=await this.commit(repo,'HEAD')
      if (i.delivered!==i.candidate) throw new Error('Target differs from reviewed integration candidate')
      await this.clean(repo)
    }
    a.state='delivered';this.save()
  }
}
