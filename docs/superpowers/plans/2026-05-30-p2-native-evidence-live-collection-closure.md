# P2 Native Evidence Live Collection Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close P2 by collecting real native UI-TARS action transcripts for `onboarding-form` and `ticket-review`, then make `npm run validate:p2-native-action-evidence` pass without fabricated or derived actions.

**Architecture:** Extend the existing native transcript exporter so it can read UI-TARS renderer state directly from a safe localhost CDP endpoint, while preserving the offline `--state-json` path. Use the existing capture runner for final judge state, the existing P2 analyzer for `summary.json` / `report.md` / `run-log.md`, and the strict native action evidence gate as the final acceptance test.

**Tech Stack:** Node.js ESM, zero-dependency HTTP and WebSocket CDP helpers, existing `src/uitars-preflight.mjs` CDP discovery, existing `src/uitars-native-transcript-export.mjs`, existing `src/native-action-evidence-pack.mjs`, npm validation scripts.

---

## Current Merged Baseline

- Branch `codex/p2-native-action-evidence-closure` has been merged into `main`.
- `npm run validate` passes on `main`.
- `npm run smoke` passes on `main`.
- `git diff --check` passes on `main`.
- `npm run validate:p2-native-action-evidence` fails for the intended reason:

```text
onboarding-form: missing expected task in P2 native action evidence summary
ticket-review: missing expected task in P2 native action evidence summary
```

This phase must not backfill those two tasks from screenshots, step traces, capture files, or run exports. Only preserved UI-TARS native transcript state can satisfy the strict P2 gate.

## File Structure

- Modify: `src/uitars-preflight.mjs`
  - Export the small CDP helpers needed by the live transcript exporter.
  - Keep existing preflight behavior unchanged.

- Modify: `src/uitars-native-transcript-export.mjs`
  - Add live CDP state extraction from a UI-TARS renderer target.
  - Keep `exportUitarsNativeTranscriptFromState()` unchanged for offline `--state-json`.
  - Add `exportUitarsNativeTranscriptFromLiveCdp()` for live collection.

- Modify: `scripts/export-uitars-native-transcript.mjs`
  - Allow `--cdp-url` and `--discover-local-uitars` to run live export when `--state-json` is omitted.
  - Preserve current offline usage.

- Modify: `scripts/validate-uitars-native-transcript-export.mjs`
  - Add a synthetic live CDP renderer fixture.
  - Verify live export writes a valid raw bundle and still rejects sensitive content before writing.

- Create: `docs/p2-native-evidence-live-collection.md`
  - Local runbook for collecting `onboarding-form` and `ticket-review`.
  - Contains exact prompts and commands.
  - Contains the rule that GitHub publishing remains postponed.

- Modify: `docs/raw-uitars-trace-schema.md`
  - Document live CDP export as the preferred P2 path.

- Modify after real collection: `experiments/2026-05-29-p2-native-action-evidence/`
  - Add:
    - `tasks/onboarding-form/raw-trace.json`
    - `tasks/onboarding-form/raw/*.json`
    - `tasks/onboarding-form/capture/capture.json`
    - `tasks/onboarding-form/capture/trace.json`
    - `tasks/onboarding-form/capture/run-export.json`
    - `tasks/ticket-review/raw-trace.json`
    - `tasks/ticket-review/raw/*.json`
    - `tasks/ticket-review/capture/capture.json`
    - `tasks/ticket-review/capture/trace.json`
    - `tasks/ticket-review/capture/run-export.json`
  - Regenerate:
    - `summary.json`
    - `report.md`
    - `run-log.md`

- Modify after gate is green: `README.md`
  - Update the P2 status from tooling-only to strict native evidence closure.

---

### Task 1: Add Live CDP Export To The Native Transcript Exporter

**Files:**
- Modify: `src/uitars-preflight.mjs`
- Modify: `src/uitars-native-transcript-export.mjs`
- Modify: `scripts/export-uitars-native-transcript.mjs`
- Modify: `scripts/validate-uitars-native-transcript-export.mjs`

- [ ] **Step 1: Add failing live CDP coverage to the exporter validator**

In `scripts/validate-uitars-native-transcript-export.mjs`, extend the import from `src/uitars-native-transcript-export.mjs`:

```js
import {
  exportUitarsNativeTranscriptFromState,
  exportUitarsNativeTranscriptFromLiveCdp,
  convertUitarsStateToRawTrace
} from '../src/uitars-native-transcript-export.mjs';
```

Add these imports near the top:

```js
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
```

Add these helper functions after `assert()`:

```js
function decodeClientFrame(buffer) {
  const lengthCode = buffer[1] & 0x7f;
  let length = lengthCode;
  let offset = 2;
  if (lengthCode === 126) {
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (lengthCode === 127) {
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % 4];
  }
  return JSON.parse(payload.toString('utf8'));
}

function encodeServerFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const headerLength = payload.length < 126 ? 2 : 4;
  const frame = Buffer.alloc(headerLength + payload.length);
  frame[0] = 0x81;
  if (payload.length < 126) {
    frame[1] = payload.length;
    payload.copy(frame, 2);
  } else {
    frame[1] = 126;
    frame.writeUInt16BE(payload.length, 2);
    payload.copy(frame, 4);
  }
  return frame;
}

async function startSyntheticUitarsCdpServer({ state }) {
  const server = createServer((request, response) => {
    if (request.url === '/json/list') {
      const body = JSON.stringify([
        {
          id: 'renderer-1',
          type: 'page',
          title: 'UI-TARS Local Browser Operator',
          url: 'http://127.0.0.1/synthetic-uitars-renderer',
          webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/renderer-1`
        }
      ]);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(body);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });

  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ].join('\r\n'));
    socket.on('data', (chunk) => {
      const message = decodeClientFrame(chunk);
      if (message.method !== 'Runtime.evaluate') {
        socket.write(encodeServerFrame({
          id: message.id,
          error: { code: -32601, message: `Synthetic fixture rejects ${message.method}` }
        }));
        return;
      }
      socket.write(encodeServerFrame({
        id: message.id,
        result: {
          result: {
            type: 'object',
            value: state
          }
        }
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    cdpUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
```

Inside the existing `try` block, after the offline export assertions, add this live export assertion:

```js
  const liveServer = await startSyntheticUitarsCdpServer({ state: stateFixture() });
  try {
    const liveExperimentDir = join(tempDir, 'live-experiment');
    const liveWritten = await exportUitarsNativeTranscriptFromLiveCdp({
      cdpUrl: liveServer.cdpUrl,
      taskId: 'settings-toggle',
      taskTitle: 'Update workspace settings',
      experimentDir: liveExperimentDir,
      prompt: 'Complete settings-toggle.',
      finalCapture,
      createdAt: '2026-05-29T00:00:00.000Z'
    });
    const liveTrace = JSON.parse(await readFile(liveWritten.rawTracePath, 'utf8'));
    assert(
      liveTrace.events.some((event) => event.type === 'action' && event.action?.name === 'click'),
      'live CDP export should preserve native action calls from the renderer state'
    );
    assert(
      JSON.stringify(liveTrace).includes('webSocketDebuggerUrl') === false,
      'live CDP export must not persist debugger websocket fields'
    );
    const liveBundleErrors = await validateRawUitarsTraceBundle(liveTrace, { bundleRoot: liveExperimentDir });
    assert(liveBundleErrors.length === 0, `live exported raw bundle should validate: ${liveBundleErrors.join('; ')}`);
  } finally {
    await liveServer.close();
  }
```

- [ ] **Step 2: Run the focused validator and confirm RED**

Run:

```bash
npm run validate:uitars-native-transcript-export
```

Expected: FAIL with an import error or function-not-exported error for `exportUitarsNativeTranscriptFromLiveCdp`.

- [ ] **Step 3: Export the shared CDP helpers**

In `src/uitars-preflight.mjs`, change these declarations:

```js
function makeCdpUrl(endpoint, path) {
```

to:

```js
export function makeCdpUrl(endpoint, path) {
```

Change:

```js
async function fetchJson(url, { timeoutMs = 5000, method = 'GET' } = {}) {
```

to:

```js
export async function fetchJson(url, { timeoutMs = 5000, method = 'GET' } = {}) {
```

Change:

```js
class CdpWebSocket {
```

to:

```js
export class CdpWebSocket {
```

Change:

```js
function assertAllowedWebSocketEndpoint(webSocketUrl, allowRemoteCdp) {
```

to:

```js
export function assertAllowedWebSocketEndpoint(webSocketUrl, allowRemoteCdp) {
```

- [ ] **Step 4: Implement live renderer state extraction**

In `src/uitars-native-transcript-export.mjs`, add this import block after the existing raw trace imports:

```js
import {
  CdpWebSocket,
  assertAllowedWebSocketEndpoint,
  discoverLocalUitarsCdpEndpoint,
  fetchJson,
  makeCdpUrl,
  normalizeCdpEndpoint
} from './uitars-preflight.mjs';
```

Add these functions before `export async function exportUitarsNativeTranscriptFromState(options)`:

```js
export function uitarsRendererStateExpression() {
  return `(() => {
    const screenshotKey = /(?:screenshot|image|frame|base64|webSocketDebuggerUrl)/i;
    function clean(value, key = '') {
      if (screenshotKey.test(key)) {
        return { omitted: true, reason: 'renderer payload omitted before CDP return', present: true };
      }
      if (Array.isArray(value)) return value.map((item) => clean(item, key));
      if (!value || typeof value !== 'object') return value;
      const out = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        if (typeof childValue === 'function' || typeof childValue === 'undefined') continue;
        out[childKey] = clean(childValue, childKey);
      }
      return out;
    }
    const candidates = [
      ['zustandBridge.getState', () => window.zustandBridge && window.zustandBridge.getState && window.zustandBridge.getState()],
      ['store.getState', () => window.store && window.store.getState && window.store.getState()],
      ['__UI_TARS_STORE__.getState', () => window.__UI_TARS_STORE__ && window.__UI_TARS_STORE__.getState && window.__UI_TARS_STORE__.getState()]
    ];
    for (const [source, getter] of candidates) {
      try {
        const state = getter();
        const messages = state && (
          state.messages ||
          state.chatMessages ||
          (state.conversation && state.conversation.messages) ||
          (state.agent && state.agent.messages)
        );
        if (Array.isArray(messages)) {
          return clean({ source, messages });
        }
      } catch {
        continue;
      }
    }
    throw new Error('No UI-TARS renderer state messages were found.');
  })()`;
}

function targetRank(target) {
  if (!target?.webSocketDebuggerUrl) return -1;
  if (!['page', 'webview'].includes(String(target.type || ''))) return -1;
  const haystack = `${target.title || ''} ${target.url || ''}`.toLowerCase();
  if (haystack.includes('ui-tars') || haystack.includes('local browser operator')) return 3;
  if (haystack.includes('renderer')) return 2;
  return 1;
}

function rankTargets(targets) {
  return [...targets]
    .map((target) => ({ target, rank: targetRank(target) }))
    .filter((entry) => entry.rank > 0)
    .sort((left, right) => right.rank - left.rank)
    .map((entry) => entry.target);
}

async function evaluateRendererState(target, { allowRemoteCdp = false, timeoutMs = 5000 } = {}) {
  assertAllowedWebSocketEndpoint(target.webSocketDebuggerUrl, allowRemoteCdp);
  const client = await CdpWebSocket.connect(target.webSocketDebuggerUrl, { timeoutMs });
  try {
    const result = await client.send('Runtime.evaluate', {
      expression: uitarsRendererStateExpression(),
      returnByValue: true,
      awaitPromise: false,
      userGesture: false
    }, { timeoutMs });
    const exceptionText = result?.exceptionDetails?.exception?.description ||
      result?.exceptionDetails?.exception?.value ||
      result?.exceptionDetails?.text ||
      '';
    if (exceptionText) throw new Error(exceptionText);
    const value = result?.result?.value;
    if (!isPlainObject(value) || !Array.isArray(value.messages)) {
      throw new Error('Runtime.evaluate did not return a UI-TARS messages object.');
    }
    return value;
  } finally {
    client.close();
  }
}

export async function readUitarsRendererStateFromCdp(options = {}) {
  let cdpUrl = options.cdpUrl;
  if (!cdpUrl && options.discoverLocalUitars) {
    const discovery = await discoverLocalUitarsCdpEndpoint();
    if (discovery.status !== 'ok') throw new Error(discovery.reason || 'Unable to discover local UI-TARS CDP endpoint.');
    cdpUrl = discovery.cdpUrl;
  }
  if (!cdpUrl) throw new Error('Provide --cdp-url, UI_TARS_CDP_URL, or --discover-local-uitars for live export.');
  const normalized = normalizeCdpEndpoint(cdpUrl, { allowRemoteCdp: Boolean(options.allowRemoteCdp) });
  const targets = await fetchJson(makeCdpUrl(normalized, '/json/list'), { timeoutMs: options.timeoutMs });
  if (!Array.isArray(targets)) throw new Error('CDP /json/list did not return an array.');
  const errors = [];
  for (const target of rankTargets(targets)) {
    try {
      const state = await evaluateRendererState(target, options);
      assertNoSensitiveContent('UI-TARS renderer state', state);
      return { state, targetTitle: target.title || '', targetUrl: target.url || '' };
    } catch (error) {
      errors.push(`${target.title || target.id || 'target'}: ${error.message}`);
    }
  }
  throw new Error(`No UI-TARS renderer target yielded state messages: ${errors.join('; ')}`);
}

export async function exportUitarsNativeTranscriptFromLiveCdp(options) {
  const live = await readUitarsRendererStateFromCdp(options);
  return exportUitarsNativeTranscriptFromState({
    ...options,
    state: live.state
  });
}
```

- [ ] **Step 5: Enable live flags in the CLI**

In `scripts/export-uitars-native-transcript.mjs`, extend the import:

```js
import {
  exportUitarsNativeTranscriptFromLiveCdp,
  exportUitarsNativeTranscriptFromState,
  readJsonFile
} from '../src/uitars-native-transcript-export.mjs';
```

Change the usage text for `--cdp-url` and `--discover-local-uitars` to:

```text
  --cdp-url <url>              Read UI-TARS renderer state from this local CDP endpoint when --state-json is omitted.
  --discover-local-uitars      Discover a local UI-TARS child Chrome CDP endpoint when --state-json is omitted.
```

Replace the current `if (!options.stateJson)` block with:

```js
if (!options.stateJson && !options.cdpUrl && !options.discoverLocalUitars) {
  throw new Error('--state-json, --cdp-url, or --discover-local-uitars is required.');
}
```

Replace the final export block with:

```js
const finalCapture = options.finalCapture ? await readJsonFile(options.finalCapture) : null;
const prompt = options.promptFile ? await readFile(options.promptFile, 'utf8') : options.prompt;
const commonOptions = {
  taskId: options.taskId,
  taskTitle: options.taskTitle || options.taskId,
  experimentDir: options.experimentDir,
  prompt,
  finalCapture
};
const result = options.stateJson
  ? await exportUitarsNativeTranscriptFromState({
    ...commonOptions,
    state: await readJsonFile(options.stateJson)
  })
  : await exportUitarsNativeTranscriptFromLiveCdp({
    ...commonOptions,
    cdpUrl: options.cdpUrl,
    discoverLocalUitars: options.discoverLocalUitars
  });
```

- [ ] **Step 6: Run focused validation and confirm GREEN**

Run:

```bash
npm run validate:uitars-native-transcript-export
```

Expected: PASS with:

```text
UI-TARS native transcript export validation passed.
```

- [ ] **Step 7: Run full repo validation**

Run:

```bash
npm run validate
npm run smoke
git diff --check
```

Expected:

```text
Finish gate validation passed: 5 checks, local-only and integration modes covered.
Smoke check passed at http://127.0.0.1:<port>.
```

`git diff --check` prints no output and exits 0.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add src/uitars-preflight.mjs src/uitars-native-transcript-export.mjs scripts/export-uitars-native-transcript.mjs scripts/validate-uitars-native-transcript-export.mjs
git commit -m "feat: export native transcript from live uitars cdp"
```

---

### Task 2: Add The P2 Live Collection Runbook

**Files:**
- Create: `docs/p2-native-evidence-live-collection.md`
- Modify: `docs/raw-uitars-trace-schema.md`

- [ ] **Step 1: Create the runbook**

Create `docs/p2-native-evidence-live-collection.md` with this content:

````markdown
# P2 Native Evidence Live Collection

This runbook collects native UI-TARS action transcripts for the strict P2 evidence pack. It is local-only and must not publish GitHub changes.

## Scope

Expected tasks:

- `settings-toggle`
- `onboarding-form`
- `ticket-review`

The existing `settings-toggle` sample is already present. This runbook collects the two missing tasks:

- `onboarding-form`
- `ticket-review`

## Safety Rules

- Do not commit credentials, tunnel hosts, private IPs, SSH commands with real hosts, browser storage, cookies, tokens, API keys, or screenshots.
- Do not reconstruct native actions from `capture.json`, `trace.json`, `run-export.json`, step traces, or screenshots.
- If live export fails because sensitive content is detected, stop and inspect the local renderer state before retrying.
- GitHub publishing is postponed until after the local project is complete.

## Start Services

Terminal 1:

```sh
npm start
```

Terminal 2:

```sh
npm run check:local
npm run check:tunnel
```

If `npm run check:tunnel` fails, restore the local model tunnel first. The expected local model endpoint is:

```text
http://127.0.0.1:18001
```

## Task: onboarding-form

Prompt for UI-TARS:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark onboarding-form task page, immediately use call_user() and do nothing else. If the onboarding-form task page is visible, Create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request. Click Evaluate and stop after the judge result is visible.
```

Prepare target:

```sh
npm run uitars:harness -- --output artifacts/p2-native-evidence-live/onboarding-form-prepare --tasks onboarding-form --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
```

Capture final benchmark state:

```sh
npm run uitars:capture -- --task onboarding-form --output experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture --base-url http://127.0.0.1:4173 --discover-local-uitars
```

Export live native transcript:

```sh
npm run uitars:export-native-transcript -- --task onboarding-form --task-title "Submit onboarding request" --experiment-dir experiments/2026-05-29-p2-native-action-evidence --final-capture experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture/capture.json --prompt "Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark onboarding-form task page, immediately use call_user() and do nothing else. If the onboarding-form task page is visible, Create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request. Click Evaluate and stop after the judge result is visible." --discover-local-uitars
```

## Task: ticket-review

Prompt for UI-TARS:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark ticket-review task page, immediately use call_user() and do nothing else. If the ticket-review task page is visible, Find Priya Shah's INC-2048 support ticket in the review queue and mark it reviewed. Click Evaluate and stop after the judge result is visible.
```

Prepare target:

```sh
npm run uitars:harness -- --output artifacts/p2-native-evidence-live/ticket-review-prepare --tasks ticket-review --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
```

Capture final benchmark state:

```sh
npm run uitars:capture -- --task ticket-review --output experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/capture --base-url http://127.0.0.1:4173 --discover-local-uitars
```

Export live native transcript:

```sh
npm run uitars:export-native-transcript -- --task ticket-review --task-title "Review priority support ticket" --experiment-dir experiments/2026-05-29-p2-native-action-evidence --final-capture experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/capture/capture.json --prompt "Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark ticket-review task page, immediately use call_user() and do nothing else. If the ticket-review task page is visible, Find Priya Shah's INC-2048 support ticket in the review queue and mark it reviewed. Click Evaluate and stop after the judge result is visible." --discover-local-uitars
```

## Rebuild P2 Pack

```sh
npm run analyze:p2-native-action-evidence -- --experiment-dir experiments/2026-05-29-p2-native-action-evidence --expected-task-ids settings-toggle,onboarding-form,ticket-review
npm run validate:p2-native-action-evidence
```

Expected final result:

```text
Native action evidence gate validation passed: passed.
```
````

- [ ] **Step 2: Link the runbook from the raw trace schema doc**

In `docs/raw-uitars-trace-schema.md`, add this paragraph in the P2 section:

```markdown
For the live collection procedure, use [P2 Native Evidence Live Collection](p2-native-evidence-live-collection.md). The live path uses `npm run uitars:export-native-transcript -- --discover-local-uitars` after the benchmark capture has been written for the same task.
```

- [ ] **Step 3: Run documentation and repo validation**

Run:

```bash
npm run validate
npm run smoke
git diff --check
```

Expected: same green results as Task 1.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
git add docs/p2-native-evidence-live-collection.md docs/raw-uitars-trace-schema.md
git commit -m "docs: add p2 native evidence live collection runbook"
```

---

### Task 3: Collect The Two Missing Native Transcripts

**Files:**
- Modify: `experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/`
- Modify: `experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/`

- [ ] **Step 1: Confirm local app and tunnel readiness**

Run in one terminal:

```bash
npm start
```

Run in another terminal:

```bash
npm run check:local
npm run check:tunnel
```

Expected:

```text
Local health check passed.
Tunnel health check passed. Models reported: <number>.
Chat compatibility: passed.
```

If `npm run check:tunnel` fails with `ECONNREFUSED 127.0.0.1:18001`, restore the tunnel and rerun this step before touching evidence artifacts.

- [ ] **Step 2: Collect `onboarding-form`**

Run the `onboarding-form` commands from `docs/p2-native-evidence-live-collection.md` in order:

```bash
npm run uitars:harness -- --output artifacts/p2-native-evidence-live/onboarding-form-prepare --tasks onboarding-form --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task onboarding-form --output experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture --base-url http://127.0.0.1:4173 --discover-local-uitars
npm run uitars:export-native-transcript -- --task onboarding-form --task-title "Submit onboarding request" --experiment-dir experiments/2026-05-29-p2-native-action-evidence --final-capture experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture/capture.json --prompt "Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark onboarding-form task page, immediately use call_user() and do nothing else. If the onboarding-form task page is visible, Create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request. Click Evaluate and stop after the judge result is visible." --discover-local-uitars
```

Expected export output:

```text
Wrote raw UI-TARS trace: experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/raw-trace.json
```

- [ ] **Step 3: Verify `onboarding-form` artifact shape**

Run:

```bash
test -f experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/raw-trace.json
test -f experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture/capture.json
node -e "const t=require('./experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/raw-trace.json'); const n=t.events.filter(e=>e.type==='action').length; if (n < 1) throw new Error('onboarding-form has no native action events'); console.log(n)"
```

Expected: the `node -e` command prints an integer greater than or equal to `1`.

- [ ] **Step 4: Collect `ticket-review`**

Run the `ticket-review` commands from `docs/p2-native-evidence-live-collection.md` in order:

```bash
npm run uitars:harness -- --output artifacts/p2-native-evidence-live/ticket-review-prepare --tasks ticket-review --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task ticket-review --output experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/capture --base-url http://127.0.0.1:4173 --discover-local-uitars
npm run uitars:export-native-transcript -- --task ticket-review --task-title "Review priority support ticket" --experiment-dir experiments/2026-05-29-p2-native-action-evidence --final-capture experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/capture/capture.json --prompt "Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark ticket-review task page, immediately use call_user() and do nothing else. If the ticket-review task page is visible, Find Priya Shah's INC-2048 support ticket in the review queue and mark it reviewed. Click Evaluate and stop after the judge result is visible." --discover-local-uitars
```

Expected export output:

```text
Wrote raw UI-TARS trace: experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/raw-trace.json
```

- [ ] **Step 5: Verify `ticket-review` artifact shape**

Run:

```bash
test -f experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/raw-trace.json
test -f experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/capture/capture.json
node -e "const t=require('./experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/raw-trace.json'); const n=t.events.filter(e=>e.type==='action').length; if (n < 1) throw new Error('ticket-review has no native action events'); console.log(n)"
```

Expected: the `node -e` command prints an integer greater than or equal to `1`.

- [ ] **Step 6: Scan new artifacts for sensitive content**

Run:

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!package-lock.json' "webSocketDebuggerUrl|Bearer |api_?key|authorization|cookie|password|token|/Users/.*/\\.ssh|/root|ssh -L|data:image" experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review
```

Expected: exit code `1` with no matches. If there are matches, inspect the artifact and rerun export only after the source leak is understood.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review artifacts/p2-native-evidence-live
git commit -m "testdata: add p2 live native action transcripts"
```

---

### Task 4: Rebuild The P2 Evidence Pack And Close The Strict Gate

**Files:**
- Modify: `experiments/2026-05-29-p2-native-action-evidence/summary.json`
- Modify: `experiments/2026-05-29-p2-native-action-evidence/report.md`
- Modify: `experiments/2026-05-29-p2-native-action-evidence/run-log.md`

- [ ] **Step 1: Rebuild the P2 summary, report, and run log**

Run:

```bash
npm run analyze:p2-native-action-evidence -- --experiment-dir experiments/2026-05-29-p2-native-action-evidence --expected-task-ids settings-toggle,onboarding-form,ticket-review
```

Expected:

```text
Wrote P2 native action evidence summary: experiments/2026-05-29-p2-native-action-evidence/summary.json
Wrote P2 native action evidence report: experiments/2026-05-29-p2-native-action-evidence/report.md
Wrote P2 native action evidence run log: experiments/2026-05-29-p2-native-action-evidence/run-log.md
```

- [ ] **Step 2: Verify the strict gate passes**

Run:

```bash
npm run validate:p2-native-action-evidence
```

Expected:

```text
Native action evidence gate validation passed: passed.
```

- [ ] **Step 3: Verify all three tasks are captured**

Run:

```bash
node -e "const s=require('./experiments/2026-05-29-p2-native-action-evidence/summary.json'); for (const id of ['settings-toggle','onboarding-form','ticket-review']) { const task=s.tasks.find(t=>t.taskId===id); if (!task) throw new Error(id+' missing'); if (task.transcriptStatus !== 'native_task_actions_captured') throw new Error(id+' status '+task.transcriptStatus); if (task.taskActionCount < 1) throw new Error(id+' has no task actions'); console.log(id, task.taskActionCount, task.taskActionNames.join(',')); }"
```

Expected: three lines, one per task, each with action count greater than or equal to `1`.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run validate
npm run smoke
npm run validate:p2-native-action-evidence
git diff --check
```

Expected:

```text
Native action evidence gate validation passed: passed.
Smoke check passed at http://127.0.0.1:<port>.
```

`git diff --check` prints no output and exits 0.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add experiments/2026-05-29-p2-native-action-evidence/summary.json experiments/2026-05-29-p2-native-action-evidence/report.md experiments/2026-05-29-p2-native-action-evidence/run-log.md
git commit -m "testdata: close p2 native action evidence gate"
```

---

### Task 5: Update Local Resume-Facing Project Wording

**Files:**
- Modify: `README.md`
- Modify: `docs/raw-uitars-trace-schema.md`
- Modify if present: `docs/interview-project-introduction.html`

- [ ] **Step 1: Update README P2 evidence boundary**

In `README.md`, replace the P2 paragraph in `Evidence Boundary / 证据边界` with:

```markdown
P2 now includes a strict native action evidence sample for `settings-toggle`, `onboarding-form`, and `ticket-review`. These samples preserve sanitized UI-TARS renderer transcript actions and validate them against final capture output. Historical expanded-round step traces remain derived timeline attributions; they are not presented as raw UI-TARS action transcripts.
```

- [ ] **Step 2: Update the evidence map**

In `README.md`, add this row to the Evidence Map table:

```markdown
| [experiments/2026-05-29-p2-native-action-evidence/summary.json](experiments/2026-05-29-p2-native-action-evidence/summary.json) | Strict P2 native UI-TARS action evidence for `settings-toggle`, `onboarding-form`, and `ticket-review` |
```

- [ ] **Step 3: Update the raw trace schema doc**

In `docs/raw-uitars-trace-schema.md`, add this sentence near the strict gate command:

```markdown
After the live collection phase, `npm run validate:p2-native-action-evidence` is expected to pass because all three expected P2 tasks have sanitized native task-action transcripts.
```

- [ ] **Step 4: Update interview HTML if it exists**

If `docs/interview-project-introduction.html` exists, update the local-only project evidence section with this exact sentence:

```html
<p>The latest P2 pass adds sanitized native UI-TARS task-action transcripts for three representative failure modes: settings toggles, onboarding form entry, and ticket review table interaction.</p>
```

Do not add screenshots, public remote details, private tunnel commands, IP addresses, tokens, cookies, or model endpoint details.

- [ ] **Step 5: Run final verification**

Run:

```bash
npm run validate
npm run smoke
npm run validate:p2-native-action-evidence
git diff --check
rg -n --hidden --glob '!node_modules/**' --glob '!package-lock.json' "Bearer |api_?key|authorization|cookie|password|token|/Users/.*/\\.ssh|/root|ssh -L [^<]|data:image|webSocketDebuggerUrl" README.md docs experiments/2026-05-29-p2-native-action-evidence
```

Expected:

- `npm run validate` exits 0.
- `npm run smoke` exits 0.
- `npm run validate:p2-native-action-evidence` exits 0.
- `git diff --check` exits 0.
- `rg` exits 1 with no matches, except if an existing doc intentionally contains the placeholder string `ssh -L 18001:127.0.0.1:8001 <remote-host>`.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add README.md docs/raw-uitars-trace-schema.md docs/interview-project-introduction.html
git commit -m "docs: update p2 native evidence project status"
```

If `docs/interview-project-introduction.html` does not exist, run:

```bash
git add README.md docs/raw-uitars-trace-schema.md
git commit -m "docs: update p2 native evidence project status"
```

---

## Final Acceptance

The phase is complete only when these commands pass on `main` or on the active implementation branch after all task commits:

```bash
npm run validate
npm run smoke
npm run validate:p2-native-action-evidence
git diff --check
```

The strict P2 summary must show:

```text
settings-toggle     native_task_actions_captured
onboarding-form     native_task_actions_captured
ticket-review       native_task_actions_captured
```

GitHub update, PR creation, and public README publishing are out of scope for this phase.

## Self-Review

- Spec coverage: Tasks 1 and 2 enable repeatable live extraction; Task 3 collects the two missing native transcripts; Task 4 rebuilds and validates the strict evidence pack; Task 5 updates local resume-facing wording after the gate is green.
- Placeholder scan: The plan contains no deferred-work markers and no steps that ask for unspecified error handling.
- Type consistency: The plan uses the existing `state`, `taskId`, `taskTitle`, `experimentDir`, `prompt`, `finalCapture`, `cdpUrl`, and `discoverLocalUitars` option names from the merged exporter and CLI.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-30-p2-native-evidence-live-collection-closure.md`. Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.
