#!/usr/bin/env node
/**
 * Drive one prompt through a live DSH dialog and print what the transcript says.
 *
 * The model-facing surface of `codex_workflow` — its action set, parameter
 * semantics, and error wording — cannot be covered by unit tests: those only
 * fail inside a real conversation. This script supplies the transport half of
 * that check and nothing else:
 *
 *   1. authenticate against the running `dsh web` origin,
 *   2. create a fresh Session on a workspace directory,
 *   3. send one ordinary user prompt and wait for the turn to settle,
 *   4. print the driving Session's transcript, plus any Session the run created
 *      (a delegated child is one).
 *
 * Nothing here asserts anything. A reply is not deterministic, so the transcript
 * is printed for an agent to read: whether the subagent started, executed, and
 * stayed healthy is a judgement made on that output, not a fixed expectation.
 *
 * Usage:
 *   DSH_TOKEN=<token from the `dsh web:` line> node scripts/dialog-check.mjs "<prompt>"
 *
 * Environment:
 *   DSH_TOKEN  required; the launch token `dsh web` printed in its URL.
 *   DSH_BASE   origin to drive; defaults to http://127.0.0.1:3080.
 *   DSH_CWD    workspace directory for the new Session; defaults to this checkout.
 *   DSH_HOME   Harness home holding the Session logs; defaults to ~/.dsh.
 *   DSH_TIMEOUT_MS  how long to wait for the turn; defaults to 180000.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';

const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3080';
const TOKEN = process.env.DSH_TOKEN;
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const CWD = resolve(process.env.DSH_CWD ?? fileURLToPath(new URL('../', import.meta.url)));
const TIMEOUT = Number(process.env.DSH_TIMEOUT_MS ?? 180_000);
const PROMPT = process.argv.slice(2).join(' ');

if (TOKEN === undefined || TOKEN === '') {
  console.error('DSH_TOKEN is required: use the token from the `dsh web:` URL.');
  process.exit(2);
}
if (PROMPT.trim() === '') {
  console.error('Usage: DSH_TOKEN=<token> node scripts/dialog-check.mjs "<prompt>"');
  process.exit(2);
}

const login = await fetch(`${BASE}/?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' });
if (login.status !== 303) {
  console.error(`Login refused with HTTP ${login.status}; is the token from the running process?`);
  process.exit(2);
}
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

let seq = 0;
/** One Connection unary call on the same route the browser uses. */
async function call(endpoint, args) {
  const response = await fetch(`${BASE}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `dialog-${++seq}`, method: endpoint, payload: { args } }),
  });
  const body = await response.json();
  if (body.result?.ok !== true) throw new Error(`${endpoint} refused: ${JSON.stringify(body.result?.error)}`);
  return body.result.value;
}

/**
 * Read one Session's durable log, which is what the dialog renders.
 *
 * The Harness encodes a Session's workspace directory into its log path, and
 * that encoding is its business: this locates the Session by asking the sessions
 * root which directory holds it, instead of predicting the encoding and silently
 * reading nothing when the guess drifts.
 *
 * The log itself is a concatenation of independently flushed zstd frames, so a
 * single `zstdDecompressSync` call would decode only the first one. Frames are
 * split on their magic number and decoded one by one; a frame still being
 * appended fails and is skipped rather than discarding the whole transcript.
 * @param sessionId - the Session whose log to read.
 * @returns the decoded events in log order.
 */
function events(sessionId) {
  const root = join(HOME, 'sessions');
  let path;
  try {
    for (const entry of readdirSync(root)) {
      const candidate = join(root, entry, sessionId, 'session.v3.jsonl.zstd');
      if (existsSync(candidate)) { path = candidate; break; }
    }
  } catch {
    return [];
  }
  if (path === undefined) return [];
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    return [];
  }
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets = [];
  for (let at = buffer.indexOf(magic); at !== -1; at = buffer.indexOf(magic, at + magic.length)) offsets.push(at);
  const decoded = [];
  for (const [index, offset] of offsets.entries()) {
    try {
      decoded.push(zstdDecompressSync(buffer.subarray(offset, offsets[index + 1] ?? buffer.length)).toString('utf8'));
    } catch {
      // A partially written trailing frame: the next read sees it whole.
    }
  }
  return decoded.join('').split('\n').filter(line => line !== '').flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

const text = blocks => (Array.isArray(blocks) ? blocks : [])
  .filter(block => block?.type === 'text' && typeof block.text === 'string')
  .map(block => block.text).join(' ');

/** Print one transcript as the sequence a reader needs to judge the run. */
function report(sessionId, label) {
  const entries = events(sessionId);
  console.log(`\n===== ${label}: ${sessionId} (${entries.length} events) =====`);
  for (const entry of entries) {
    const type = entry.type ?? entry.event?.type;
    const data = entry.data ?? entry.event?.data ?? {};
    if (type === 'user/message') console.log('[user]', text(data.content).slice(0, 300));
    else if (type === 'assistant/message') console.log('[assistant]', text(data.message?.content).slice(0, 600));
    else if (type === 'tool/call') console.log('[tool]', data.name, JSON.stringify(data.arguments ?? {}).slice(0, 400));
    else if (type === 'tool/result') console.log('[result]', text(data.message?.content).slice(0, 400));
    else if (type === 'turn/end') console.log('[turn/end]', JSON.stringify(data.reason ?? {}));
  }
  return entries;
}

const before = new Set((await call('session/list', { _request: {} })).items.map(item => item.sessionId));
const created = await call('session/create', { request: { cwd: CWD } });
const driving = created.sessionId;
console.log(`base: ${BASE}`);
console.log(`cwd: ${CWD}`);
console.log(`session: ${driving}`);
console.log(`prompt: ${PROMPT}\n`);

await call('session/prompt', { request: {
  requestId: `dialog-${Date.now()}`,
  sessionId: driving,
  mode: 'queue',
  content: [{ type: 'text', text: PROMPT }],
} });

const settled = () => events(driving).some(entry => (entry.type ?? entry.event?.type) === 'turn/end');
const deadline = Date.now() + TIMEOUT;
let waited = 0;
while (!settled() && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  waited += 1000;
  // Progress goes to stderr so a supervising process sees the wait is alive.
  if (waited % 5000 === 0) console.error(`  ... ${waited / 1000}s, ${events(driving).length} events`);
}
console.log(`turn settled: ${settled()}${settled() ? '' : ' (timed out; the transcript below is partial)'}`);

report(driving, 'driving session');
// Anything the run created (a delegated child is its own Session) is printed too.
const after = (await call('session/list', { _request: {} })).items.map(item => item.sessionId);
for (const id of after.filter(candidate => !before.has(candidate) && candidate !== driving)) report(id, 'session created by the run');
