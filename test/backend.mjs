export class Backend {
  guards = new Set(); sessions = new Map(); listeners = new Map(); events = new Map(); calls = []; sequence = 0;
  installGuard(guard) { this.guards.add(guard); return () => this.guards.delete(guard); }
  check(value) { for (const guard of this.guards) guard(value); }
  key(owner, id) { return `${owner}/${id}`; }
  async createSession(ownerId, sessionId, cwd, options = {}) { this.check({ ownerId, sessionId, cwd, boundary: options.boundary, action: "create" }); const value = { sessionId, threadId: `thread-${sessionId}`, cwd, model: options.model, reasoningEffort: options.reasoningEffort, state: "idle" }; this.sessions.set(this.key(ownerId, sessionId), value); return structuredClone(value); }
  async listSessions(ownerId) { return [...this.sessions.entries()].filter(([key]) => key.startsWith(`${ownerId}/`)).map(([, value]) => value); }
  async readSession(ownerId, sessionId) { return structuredClone(this.sessions.get(this.key(ownerId, sessionId))); }
  async resumeSession(ownerId, sessionId) { this.check({ ownerId, sessionId, action: "resume" }); return this.readSession(ownerId, sessionId); }
  async configureSession(ownerId, sessionId, options) { this.check({ ownerId, sessionId, action: "configure" }); const value = this.sessions.get(this.key(ownerId, sessionId)); Object.assign(value, { model: options.model ?? value.model, reasoningEffort: options.reasoningEffort ?? value.reasoningEffort }); return structuredClone(value); }
  async closeSession(ownerId, sessionId) { this.check({ ownerId, sessionId, action: "close" }); }
  async searchThreads() { return { data: [{ id: "history-thread", cwd: "/history", status: { type: "idle" } }], nextCursor: null }; }
  async importSession(ownerId, sessionId, threadId) { if ([...this.sessions.values()].some(session => session.threadId === threadId)) throw new Error("occupied"); const value = { sessionId, threadId, cwd: "/history", state: "idle", model: "stored", reasoningEffort: "high" }; this.sessions.set(this.key(ownerId, sessionId), value); return structuredClone(value); }
  async occupiedThreads() { return [...this.sessions.values()].map(session => session.threadId); }
  async startTurn(ownerId, sessionId, input, options) { this.calls.push({ method: "turn/start", input, options }); this.check({ ownerId, sessionId, action: "start" }); const session = this.sessions.get(this.key(ownerId, sessionId)); const turn = { sessionId, threadId: session.threadId, turnId: `turn-${++this.sequence}`, state: "running" }; session.state = "running"; this.push(ownerId, sessionId, { type: "turn.started", turn }); return structuredClone(turn); }
  async steerTurn(ownerId, turnId) { this.check({ ownerId, turnId, action: "steer" }); }
  async interruptTurn(ownerId, turnId) { this.check({ ownerId, turnId, action: "interrupt" }); }
  async compactSession(ownerId, sessionId) { const session = this.sessions.get(this.key(ownerId, sessionId)), turnId = `compact-${++this.sequence}`; this.push(ownerId, sessionId, { type: "turn.state", operation: "compact", turn: { sessionId, threadId: session.threadId, turnId, state: "completed" } }); }
  async reviewSession(ownerId, sessionId) { const session = this.sessions.get(this.key(ownerId, sessionId)), turn = { sessionId, threadId: session.threadId, turnId: `review-${++this.sequence}`, state: "running" }; session.state = "running"; this.push(ownerId, sessionId, { type: "turn.started", turn }); return turn; }
  async pendingApprovals() { return []; }
  async decideApproval(ownerId) { this.check({ ownerId, action: "approval" }); }
  async history() { return []; }
  subscribe(ownerId, sessionId, listener) { const key = this.key(ownerId, sessionId), set = this.listeners.get(key) ?? new Set(); set.add(listener); this.listeners.set(key, set); return () => set.delete(listener); }
  async readEvents(ownerId, sessionId, after = 0) { return (this.events.get(this.key(ownerId, sessionId)) ?? []).filter(item => item.sequence > after); }
  async listModels() { return [{ model: "stored", displayName: "Stored", isDefault: true, defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }] }]; } async readConfig() { return { config: { model: "stored", model_reasoning_effort: "high" } }; } async listSkills(cwd) { return [{ cwd, skills: [{ name: "demo", path: "/skills/demo/SKILL.md", description: "Demo", enabled: true }], errors: [] }]; }
  push(ownerId, sessionId, event) { const key = this.key(ownerId, sessionId), records = this.events.get(key) ?? []; const record = { sequence: ++this.sequence, event }; records.push(record); this.events.set(key, records); for (const listener of this.listeners.get(key) ?? []) listener(event); }
  complete(ownerId, sessionId, turnId, result = "done") { const session = this.sessions.get(this.key(ownerId, sessionId)); session.state = "idle"; const event = { type: "turn.state", turn: { sessionId, threadId: session.threadId, turnId, state: "completed" }, finalOutput: result }; this.push(ownerId, sessionId, event); this.push(ownerId, sessionId, event); }
}
