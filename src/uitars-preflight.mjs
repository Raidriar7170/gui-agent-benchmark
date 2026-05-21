import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect as connectTcp } from 'node:net';
import { dirname } from 'node:path';
import { connect as connectTls } from 'node:tls';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PREFLIGHT_SCHEMA_VERSION = 1;
export const DEFAULT_BENCHMARK_URL = 'http://127.0.0.1:4173/?task=onboarding-form';
export const PREFLIGHT_STATUSES = new Set(['ready', 'needs_fix', 'fixed', 'blocked', 'ambiguous', 'error']);

const localhostNames = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const sensitiveKeyPattern = /(?:websocketdebuggerurl|base64|api_?key|token|password|passwd|cookie|authorization|localstorage|screenshot)/i;
const sensitiveValuePattern = /(?:websocketdebuggerurl|api_?key|token|password|passwd|cookie|authorization)\s*[:=]/i;
const userInfoUrlPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@/i;

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeout);
    }
  };
}

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
}

function isLocalCdpHost(hostname) {
  return localhostNames.has(hostname.toLowerCase());
}

export function normalizeCdpEndpoint(value, { allowRemoteCdp = false } = {}) {
  const url = parseUrl(value, 'CDP endpoint');
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('CDP endpoint must use http: or https:.');
  }
  if (url.username || url.password) {
    throw new Error('CDP endpoint must not include credentials.');
  }
  if (!allowRemoteCdp && !isLocalCdpHost(url.hostname)) {
    throw new Error('CDP endpoint must be localhost, 127.0.0.1, or ::1 unless --allow-remote-cdp is set.');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

export function normalizeBenchmarkUrl(value, { allowRemoteBenchmark = false } = {}) {
  const url = parseUrl(value || DEFAULT_BENCHMARK_URL, 'Benchmark URL');
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Benchmark URL must use http: or https:.');
  }
  if (url.username || url.password) {
    throw new Error('Benchmark URL must not include credentials.');
  }
  if (!allowRemoteBenchmark && !isLocalCdpHost(url.hostname)) {
    throw new Error('Benchmark URL must be localhost, 127.0.0.1, or ::1 unless --allow-remote-benchmark is set.');
  }
  return url;
}

function sanitizeString(value) {
  const text = String(value || '');
  if (/^data:image\/[^;]+;base64,/i.test(text) || /^[A-Za-z0-9+/=]{400,}$/.test(text)) {
    return '[redacted]';
  }
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1')
    .replace(/(?:api_?key|token|password|passwd|cookie|authorization|localstorage|screenshot|base64)=([^&\s]+)/gi, '[redacted]')
    .replace(/websocketdebuggerurl|api_?key|token|password|passwd|cookie|authorization|localstorage|screenshot|base64/gi, '[redacted]');
}

export function sanitizeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:', 'about:'].includes(url.protocol)) return '[redacted-url]';
    if (url.protocol === 'about:') return url.href;
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveKeyPattern.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return sanitizeString(url.href);
  } catch {
    return sanitizeString(value);
  }
}

export function sanitizeTarget(target) {
  return {
    id: sanitizeString(target?.id),
    type: sanitizeString(target?.type),
    title: sanitizeString(target?.title),
    url: sanitizeUrl(target?.url)
  };
}

function sanitizeVersion(version) {
  return {
    browser: sanitizeString(version?.Browser),
    protocolVersion: sanitizeString(version?.['Protocol-Version'])
  };
}

function makeCdpUrl(endpoint, path) {
  const url = new URL(endpoint.href);
  url.pathname = `${endpoint.pathname}${path}`.replace(/\/{2,}/g, '/');
  return url;
}

async function fetchJson(url, { timeoutMs = 5000 } = {}) {
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, { signal: timeout.signal });
    if (!response.ok) {
      throw new Error(`${url.pathname} returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    timeout.clear();
  }
}

function targetKind(target) {
  return target?.type === 'page' ? 'page' : 'other';
}

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '');
}

export function isBenchmarkTarget(target, benchmarkUrl) {
  if (targetKind(target) !== 'page') return false;
  if (String(target.title || '').includes('GUI Agent Benchmark')) return true;
  try {
    const targetUrl = new URL(target.url);
    return targetUrl.origin === benchmarkUrl.origin
      && normalizePathname(targetUrl.pathname) === normalizePathname(benchmarkUrl.pathname);
  } catch {
    return false;
  }
}

function hostMatches(hostname, base) {
  const host = hostname.toLowerCase();
  return host === base || host.endsWith(`.${base}`);
}

export function isSearchTarget(target) {
  if (targetKind(target) !== 'page') return false;
  const title = String(target.title || '');
  try {
    const url = new URL(target.url || '');
    const path = normalizePathname(url.pathname);
    if (hostMatches(url.hostname, 'google.com') || /^www\.google\.[a-z.]+$/i.test(url.hostname)) {
      return ['/', '/search', '/webhp'].includes(path) || /^Google(?: Search)?$/i.test(title);
    }
    if (hostMatches(url.hostname, 'bing.com')) {
      return ['/', '/search'].includes(path) || /\bBing\b/i.test(title);
    }
    if (hostMatches(url.hostname, 'baidu.com')) {
      return ['/', '/s'].includes(path) || /(?:Baidu|百度)/i.test(title);
    }
  } catch {
    return /^(?:Google|Bing)$|(?:Baidu|百度)/i.test(title);
  }
  return false;
}

function parsePs(stdout) {
  return stdout
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
    })
    .filter(Boolean);
}

function isUiTarsAppProcess(command) {
  return /(?:^|\s)(?:"[^"]*\/UI TARS\.app\/Contents\/MacOS\/UI-TARS"|'[^']*\/UI TARS\.app\/Contents\/MacOS\/UI-TARS'|\/.*?\/UI TARS\.app\/Contents\/MacOS\/UI-TARS)(?:\s|$)/.test(command);
}

function hasUiTarsAppAncestor(processInfo, processMap) {
  let current = processMap.get(processInfo.ppid);
  const seen = new Set();
  while (current && !seen.has(current.pid)) {
    seen.add(current.pid);
    if (isUiTarsAppProcess(current.command)) return true;
    current = processMap.get(current.ppid);
  }
  return false;
}

function extractUserDataDir(command) {
  const patterns = [
    /--user-data-dir=(?:"([^"]+)"|'([^']+)'|(\S+))/,
    /--user-data-dir\s+(?:"([^"]+)"|'([^']+)'|(\S+))/
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) return match.slice(1).find(Boolean);
  }
  return null;
}

export async function discoverLocalUitarsCdpEndpoint() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
      timeout: 5000,
      maxBuffer: 1024 * 1024 * 8
    }));
  } catch (error) {
    return {
      status: 'blocked',
      reason: `Unable to inspect local process tree: ${error.message}`
    };
  }

  const processes = parsePs(stdout);
  const processMap = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const candidates = processes.filter((processInfo) => {
    const command = processInfo.command;
    return /(?:Chrome|Chromium|chrome|chromium)/.test(command)
      && !command.includes('--type=')
      && command.includes('puppeteer_dev_chrome_profile')
      && command.includes('--remote-debugging-port=0')
      && hasUiTarsAppAncestor(processInfo, processMap);
  });

  if (candidates.length === 0) {
    return {
      status: 'blocked',
      reason: 'No UI-TARS child Chrome with a Puppeteer profile and remote-debugging-port=0 was found.'
    };
  }
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      reason: `Found ${candidates.length} matching UI-TARS child Chrome processes. Provide --cdp-url explicitly.`
    };
  }

  const profileDir = extractUserDataDir(candidates[0].command);
  if (!profileDir || !profileDir.includes('puppeteer_dev_chrome_profile')) {
    return {
      status: 'blocked',
      reason: 'Matching UI-TARS child Chrome did not expose a safe Puppeteer profile path.'
    };
  }

  let portFile;
  try {
    portFile = await readFile(`${profileDir}/DevToolsActivePort`, 'utf8');
  } catch {
    return {
      status: 'blocked',
      reason: 'Matching UI-TARS child Chrome has no readable DevToolsActivePort file.'
    };
  }

  const port = Number(portFile.split(/\r?\n/)[0]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return {
      status: 'blocked',
      reason: 'DevToolsActivePort did not contain a valid local port.'
    };
  }

  return {
    status: 'ready',
    endpoint: `http://127.0.0.1:${port}`,
    source: 'discovered-local-uitars',
    confidence: 'ui-tars-app-parent-chain'
  };
}

class CdpWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (error) => this.rejectAll(error));
    socket.on('close', () => this.rejectAll(new Error('CDP WebSocket closed.')));
  }

  static async connect(webSocketUrl, { timeoutMs = 5000 } = {}) {
    const url = new URL(webSocketUrl);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('CDP target did not provide a ws: or wss: URL.');
    const isTls = url.protocol === 'wss:';
    const port = Number(url.port || (isTls ? 443 : 80));
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const key = randomBytes(16).toString('base64');
    const socket = isTls
      ? connectTls({ host, port, servername: host })
      : connectTcp({ host, port });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out connecting to CDP WebSocket.')), timeoutMs);
      socket.once(isTls ? 'secureConnect' : 'connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    const path = `${url.pathname}${url.search}`;
    socket.write([
      `GET ${path} HTTP/1.1`,
      `Host: ${url.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '\r\n'
    ].join('\r\n'));

    const handshake = await readHandshake(socket, timeoutMs);
    if (!handshake.startsWith('HTTP/1.1 101')) throw new Error('CDP WebSocket upgrade was rejected.');
    const accept = handshake.match(/sec-websocket-accept:\s*(.+)\r?\n/i)?.[1]?.trim();
    const expected = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    if (accept !== expected) throw new Error('CDP WebSocket upgrade returned an invalid accept key.');
    return new CdpWebSocket(socket);
  }

  send(method, params = {}, { timeoutMs = 5000 } = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.socket.write(encodeClientFrame(Buffer.from(payload, 'utf8')));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.socket.end(encodeClientFrame(Buffer.alloc(0), 0x8));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const frame = decodeServerFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.bytes);
      if (frame.opcode === 0x9) {
        this.socket.write(encodeClientFrame(frame.payload, 0xA));
        continue;
      }
      if (frame.opcode === 0x8) {
        this.rejectAll(new Error('CDP WebSocket closed.'));
        return;
      }
      if (frame.opcode !== 0x1) continue;
      let message;
      try {
        message = JSON.parse(frame.payload.toString('utf8'));
      } catch {
        continue;
      }
      if (!message.id || !this.pending.has(message.id)) continue;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'CDP command failed.'));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function readHandshake(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => finish(reject, new Error('Timed out during CDP WebSocket upgrade.')), timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
    }
    function finish(callback, value) {
      cleanup();
      callback(value);
    }
    function onError(error) {
      finish(reject, error);
    }
    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      const marker = buffer.indexOf('\r\n\r\n');
      if (marker !== -1) {
        finish(resolve, buffer.subarray(0, marker + 4).toString('latin1'));
      }
    }

    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function encodeClientFrame(payload, opcode = 0x1) {
  const length = payload.length;
  const headerLength = length < 126 ? 2 : length <= 0xffff ? 4 : 10;
  const frame = Buffer.alloc(headerLength + 4 + length);
  frame[0] = 0x80 | opcode;
  if (length < 126) {
    frame[1] = 0x80 | length;
  } else if (length <= 0xffff) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }
  const maskOffset = headerLength;
  const mask = randomBytes(4);
  mask.copy(frame, maskOffset);
  for (let index = 0; index < length; index += 1) {
    frame[maskOffset + 4 + index] = payload[index] ^ mask[index % 4];
  }
  return frame;
}

function decodeServerFrame(buffer) {
  const byte2 = buffer[1];
  let length = byte2 & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const masked = Boolean(byte2 & 0x80);
  const maskOffset = masked ? offset : -1;
  const payloadOffset = offset + (masked ? 4 : 0);
  if (buffer.length < payloadOffset + length) return null;
  const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + length));
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return {
    opcode: buffer[0] & 0x0f,
    payload,
    bytes: payloadOffset + length
  };
}

function assertAllowedWebSocketEndpoint(webSocketUrl, allowRemoteCdp) {
  const url = new URL(webSocketUrl);
  if (url.username || url.password) {
    throw new Error('CDP target WebSocket must not include credentials.');
  }
  if (!allowRemoteCdp && !isLocalCdpHost(url.hostname)) {
    throw new Error('CDP target WebSocket must be localhost, 127.0.0.1, or ::1 unless --allow-remote-cdp is set.');
  }
}

async function navigateTarget(target, benchmarkUrl, { allowRemoteCdp = false } = {}) {
  assertAllowedWebSocketEndpoint(target.webSocketDebuggerUrl, allowRemoteCdp);
  const client = await CdpWebSocket.connect(target.webSocketDebuggerUrl);
  try {
    await client.send('Page.navigate', { url: benchmarkUrl.href });
  } finally {
    client.close();
  }
}

function baseReport({ source, benchmarkUrl, cdpUrl, fix }) {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    source,
    timestamp,
    status: 'error',
    reason: '',
    mode: { fix: Boolean(fix) },
    benchmark: {
      url: sanitizeUrl(benchmarkUrl.href),
      origin: benchmarkUrl.origin,
      path: normalizePathname(benchmarkUrl.pathname)
    },
    cdp: {
      endpoint: cdpUrl ? sanitizeUrl(cdpUrl.href) : ''
    },
    actions: [],
    targetsBefore: [],
    targetsAfter: [],
    warnings: []
  };
}

export async function runUitarsPreflight(options = {}) {
  let benchmarkUrl;
  try {
    benchmarkUrl = normalizeBenchmarkUrl(options.benchmarkUrl || DEFAULT_BENCHMARK_URL, {
      allowRemoteBenchmark: options.allowRemoteBenchmark
    });
  } catch (error) {
    return {
      schemaVersion: PREFLIGHT_SCHEMA_VERSION,
      source: options.source || 'explicit',
      timestamp: new Date().toISOString(),
      status: 'blocked',
      reason: sanitizeString(error.message),
      mode: { fix: Boolean(options.fix) },
      benchmark: {
        url: '',
        origin: '',
        path: ''
      },
      cdp: {
        endpoint: ''
      },
      actions: [],
      targetsBefore: [],
      targetsAfter: [],
      warnings: []
    };
  }
  let source = options.source || 'explicit';
  let endpointValue = options.cdpUrl;
  const fix = Boolean(options.fix);
  let discoveryConfidence = '';
  const warnings = [];

  if (!endpointValue && options.discoverLocalUitars) {
    const discovery = await discoverLocalUitarsCdpEndpoint();
    source = discovery.source || 'discovered-local-uitars';
    if (discovery.status !== 'ready') {
      const report = baseReport({ source, benchmarkUrl, cdpUrl: null, fix });
      report.status = discovery.status;
      report.reason = discovery.reason;
      report.warnings = warnings;
      return report;
    }
    endpointValue = discovery.endpoint;
    discoveryConfidence = discovery.confidence || '';
  }

  if (!endpointValue) {
    const report = baseReport({ source, benchmarkUrl, cdpUrl: null, fix });
    report.status = 'blocked';
    report.reason = 'Provide --cdp-url, UI_TARS_CDP_URL, or enable --discover-local-uitars.';
    report.warnings = warnings;
    return report;
  }

  let cdpUrl;
  try {
    cdpUrl = normalizeCdpEndpoint(endpointValue, { allowRemoteCdp: options.allowRemoteCdp });
  } catch (error) {
    const report = baseReport({ source, benchmarkUrl, cdpUrl: null, fix });
    report.status = 'blocked';
    report.reason = error.message;
    report.warnings = warnings;
    return report;
  }

  const report = baseReport({ source, benchmarkUrl, cdpUrl, fix });
  const hasDiscoveryConfidence = source === 'discovered-local-uitars' && Boolean(discoveryConfidence);
  if (fix && !hasDiscoveryConfidence && !options.confirmExplicitCdpFix) {
    report.status = 'blocked';
    report.reason = 'Explicit CDP endpoint fix mode requires --confirm-explicit-cdp-fix or UI_TARS_CONFIRM_EXPLICIT_CDP_FIX=1.';
    report.warnings = warnings;
    return report;
  }

  try {
    const [version, targets] = await Promise.all([
      fetchJson(makeCdpUrl(cdpUrl, '/json/version'), { timeoutMs: options.timeoutMs }),
      fetchJson(makeCdpUrl(cdpUrl, '/json/list'), { timeoutMs: options.timeoutMs })
    ]);
    report.cdp.version = sanitizeVersion(version);

    const pageTargets = Array.isArray(targets) ? targets.filter((target) => target?.type === 'page') : [];
    report.targetsBefore = pageTargets.map(sanitizeTarget);
    const benchmarkTargets = pageTargets.filter((target) => isBenchmarkTarget(target, benchmarkUrl));
    const searchTargets = pageTargets.filter(isSearchTarget);

    if (benchmarkTargets.length > 1) {
      warnings.push(`Found ${benchmarkTargets.length} benchmark page targets.`);
    }

    if (searchTargets.length === 0) {
      if (benchmarkTargets.length > 0) {
        report.status = 'ready';
        report.reason = 'Benchmark target is already present and no search page target needs correction.';
      } else {
        report.status = 'blocked';
        report.reason = 'No benchmark target or supported Google/Bing/Baidu search page target was found.';
      }
      return report;
    }

    if (!fix) {
      report.status = 'needs_fix';
      report.reason = `Found ${searchTargets.length} supported search page target${searchTargets.length === 1 ? '' : 's'} that can be navigated to the benchmark URL with --fix.`;
      report.actions = searchTargets.map((target) => ({
        action: 'dry_run_match',
        status: 'planned',
        target: sanitizeTarget(target),
        navigateTo: sanitizeUrl(benchmarkUrl.href)
      }));
      return report;
    }

    for (const target of searchTargets) {
      const action = {
        action: 'Page.navigate',
        status: 'pending',
        target: sanitizeTarget(target),
        navigateTo: sanitizeUrl(benchmarkUrl.href)
      };
      report.actions.push(action);
      try {
        if (!target.webSocketDebuggerUrl) throw new Error('Target does not expose a CDP WebSocket URL.');
        await navigateTarget(target, benchmarkUrl, { allowRemoteCdp: options.allowRemoteCdp });
        action.status = 'ok';
      } catch (error) {
        action.status = 'error';
        action.reason = sanitizeString(error.message);
      }
    }

    const targetsAfter = await fetchJson(makeCdpUrl(cdpUrl, '/json/list'), { timeoutMs: options.timeoutMs });
    const afterPages = Array.isArray(targetsAfter) ? targetsAfter.filter((target) => target?.type === 'page') : [];
    report.targetsAfter = afterPages.map(sanitizeTarget);
    const afterBenchmarkTargets = afterPages.filter((target) => isBenchmarkTarget(target, benchmarkUrl));
    const failedActions = report.actions.filter((action) => action.status !== 'ok');

    if (failedActions.length > 0) {
      report.status = 'error';
      report.reason = `${failedActions.length} target navigation action${failedActions.length === 1 ? '' : 's'} failed.`;
    } else if (afterBenchmarkTargets.length > 0) {
      report.status = 'fixed';
      report.reason = `Navigated ${searchTargets.length} search page target${searchTargets.length === 1 ? '' : 's'} to the benchmark URL.`;
    } else {
      report.status = 'blocked';
      report.reason = 'Navigation completed but no benchmark target was visible afterward.';
    }
    return report;
  } catch (error) {
    report.status = 'error';
    report.reason = sanitizeString(error.message);
    return report;
  } finally {
    report.warnings = warnings;
  }
}

export async function writePreflightReport(report, outputPath) {
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (!outputPath) return body;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body, 'utf8');
  return body;
}

function validateObjectShape(value, errors, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
  }
}

function inspectSensitive(value, errors, path) {
  if (typeof value === 'string') {
    if (
      sensitiveValuePattern.test(value)
      || /websocketdebuggerurl/i.test(value)
      || userInfoUrlPattern.test(value)
      || /^data:image\/[^;]+;base64,/i.test(value)
      || /^[A-Za-z0-9+/=]{400,}$/.test(value)
    ) {
      errors.push(`${path} contains sensitive-looking content`);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) errors.push(`${path}.${key} uses a prohibited field name`);
    inspectSensitive(child, errors, `${path}.${key}`);
  }
}

function validateTargets(targets, errors, path) {
  if (!Array.isArray(targets)) {
    errors.push(`${path} must be an array`);
    return;
  }
  for (const [index, target] of targets.entries()) {
    validateObjectShape(target, errors, `${path}[${index}]`);
    const keys = Object.keys(target || {});
    for (const key of keys) {
      if (!['id', 'type', 'title', 'url'].includes(key)) {
        errors.push(`${path}[${index}] contains unsupported field ${key}`);
      }
    }
    for (const key of ['id', 'type', 'title', 'url']) {
      if (typeof target?.[key] !== 'string') errors.push(`${path}[${index}].${key} must be a string`);
    }
    inspectSensitive(target, errors, `${path}[${index}]`);
  }
}

export function validatePreflightReport(report) {
  const errors = [];
  validateObjectShape(report, errors, 'report');
  if (report?.schemaVersion !== PREFLIGHT_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PREFLIGHT_SCHEMA_VERSION}`);
  for (const key of ['source', 'timestamp', 'status', 'reason']) {
    if (typeof report?.[key] !== 'string') errors.push(`${key} must be a string`);
  }
  if (!PREFLIGHT_STATUSES.has(report?.status)) errors.push(`status must be one of ${[...PREFLIGHT_STATUSES].join(', ')}`);
  validateObjectShape(report?.mode, errors, 'mode');
  if (typeof report?.mode?.fix !== 'boolean') errors.push('mode.fix must be a boolean');
  validateObjectShape(report?.benchmark, errors, 'benchmark');
  validateObjectShape(report?.cdp, errors, 'cdp');
  if (!Array.isArray(report?.actions)) errors.push('actions must be an array');
  if (!Array.isArray(report?.warnings)) errors.push('warnings must be an array');
  validateTargets(report?.targetsBefore, errors, 'targetsBefore');
  validateTargets(report?.targetsAfter, errors, 'targetsAfter');
  inspectSensitive(report, errors, 'report');
  return errors;
}
