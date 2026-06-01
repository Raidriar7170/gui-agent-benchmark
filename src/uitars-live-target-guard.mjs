import {
  discoverLocalUitarsCdpEndpoint,
  fetchJson,
  isBenchmarkTarget,
  isSearchTarget,
  makeCdpUrl,
  normalizeBenchmarkUrl,
  normalizeCdpEndpoint,
  sanitizeTarget,
  sanitizeUrl
} from './uitars-preflight.mjs';
import {
  readUitarsRendererStateFromCdp
} from './uitars-native-transcript-export.mjs';

export const UITARS_LIVE_TARGET_GUARD_SCHEMA_VERSION = 1;

const EXTERNAL_BLOCKLIST = [
  /signin\./i,
  /login/i,
  /auth/i,
  /volcengine\.com/i,
  /google\.[a-z.]+\/(?:search|webhp)?/i,
  /bing\.com\/search/i,
  /baidu\.com\/s/i
];

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SENSITIVE_REPORT_KEY_PATTERN = String.raw`(?:webSocketDebuggerUrl|api[_-]?key|apiKey|passwd|password|token|authorization|cookie|headers?|localstorage|screenshot|base64)`;
const SENSITIVE_REPORT_KEY_VALUE_PATTERN = new RegExp(
  String.raw`\b${SENSITIVE_REPORT_KEY_PATTERN}\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}|\[[^\]]*\]|[^\s,;]+)`,
  'gi'
);
const SENSITIVE_REPORT_WORD_PATTERN = new RegExp(String.raw`\b${SENSITIVE_REPORT_KEY_PATTERN}\b`, 'gi');
const PRIVATE_IPV4_PATTERN = /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})\b/g;
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>\\]+/gi;
const RAW_WEBSOCKET_URL_PATTERN = /\bwss?:\/\/[^\s"'<>\\]+/gi;
const HOSTNAME_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;

function isLocalHostname(hostname) {
  return LOCAL_HOSTNAMES.has(String(hostname || '').toLowerCase());
}

function sanitizeReportHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!isLocalHostname(url.hostname)) return '[redacted-url]';
    return sanitizeUrl(url.href);
  } catch {
    return '[redacted-url]';
  }
}

function sanitizeReportIp(value) {
  return value === '127.0.0.1' ? value : '[redacted-ip]';
}

function sanitizeReportHostname(value) {
  return isLocalHostname(value) ? value : '[redacted-host]';
}

function isExternalHttpTarget(target) {
  try {
    const url = new URL(target?.url || '');
    return ['http:', 'https:'].includes(url.protocol) && !isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isAboutTarget(target) {
  try {
    return new URL(target?.url || '').protocol === 'about:';
  } catch {
    return false;
  }
}

export function sanitizeReportString(value) {
  const text = String(value || '');
  if (/^data:image\/[^;]+;base64,/i.test(text) || /^[A-Za-z0-9+/=]{400,}$/.test(text)) {
    return '[redacted]';
  }
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1')
    .replace(RAW_WEBSOCKET_URL_PATTERN, '[redacted-url]')
    .replace(HTTP_URL_PATTERN, sanitizeReportHttpUrl)
    .replace(PRIVATE_IPV4_PATTERN, '[redacted-ip]')
    .replace(IPV4_PATTERN, sanitizeReportIp)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted]')
    .replace(SENSITIVE_REPORT_KEY_VALUE_PATTERN, '[redacted]')
    .replace(SENSITIVE_REPORT_WORD_PATTERN, '[redacted]')
    .replace(HOSTNAME_PATTERN, sanitizeReportHostname);
}

function sanitizeGuardTarget(target) {
  const sanitized = sanitizeTarget(target);
  return {
    ...sanitized,
    id: sanitizeReportString(sanitized.id),
    title: sanitizeReportString(sanitized.title),
    url: sanitizeReportString(sanitized.url)
  };
}

function setReportReason(report, reason) {
  report.reason = sanitizeReportString(reason);
  return report;
}

function isExternalBlockedTarget(target, benchmarkUrl) {
  if (target?.type !== 'page') return false;
  if (isBenchmarkTarget(target, benchmarkUrl)) return false;
  if (isSearchTarget(target)) return true;
  if (isExternalHttpTarget(target)) return true;
  if (isAboutTarget(target)) return false;
  const text = `${target.title || ''} ${target.url || ''}`;
  return EXTERNAL_BLOCKLIST.some((pattern) => pattern.test(text));
}

async function resolveCdpEndpoint(options) {
  if (options.cdpUrl) return options.cdpUrl;
  if (!options.discoverLocalUitars) {
    throw new Error('Provide --cdp-url, UI_TARS_CDP_URL, or --discover-local-uitars.');
  }

  const discovery = await discoverLocalUitarsCdpEndpoint();
  if (!['ok', 'ready'].includes(discovery?.status)) {
    throw new Error(discovery?.reason || 'Unable to discover local UI-TARS CDP endpoint.');
  }
  return discovery.cdpUrl || discovery.endpoint;
}

async function resolveRendererCdpEndpoint(options, fallbackCdpUrl) {
  if (options.rendererCdpUrl) return options.rendererCdpUrl;
  if (options.rendererEndpoint) return options.rendererEndpoint;
  return fallbackCdpUrl.href;
}

export async function evaluateLiveTargetGuard(options = {}) {
  const taskId = String(options.taskId || '').trim();
  const benchmarkUrl = normalizeBenchmarkUrl(options.benchmarkUrl, {
    allowRemoteBenchmark: Boolean(options.allowRemoteBenchmark)
  });
  const cdpUrl = normalizeCdpEndpoint(await resolveCdpEndpoint(options), {
    allowRemoteCdp: Boolean(options.allowRemoteCdp)
  });
  const report = {
    schemaVersion: UITARS_LIVE_TARGET_GUARD_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    taskId,
    verdict: 'blocked',
    reason: '',
    benchmark: {
      url: sanitizeReportString(sanitizeUrl(benchmarkUrl.href))
    },
    cdp: {
      endpoint: sanitizeReportString(sanitizeUrl(cdpUrl.href))
    },
    exactTargets: [],
    blockedTargets: [],
    warnings: []
  };

  const [version, targets] = await Promise.all([
    fetchJson(makeCdpUrl(cdpUrl, '/json/version'), { timeoutMs: options.timeoutMs }),
    fetchJson(makeCdpUrl(cdpUrl, '/json/list'), { timeoutMs: options.timeoutMs })
  ]);
  report.cdp.version = {
    browser: sanitizeReportString(version?.Browser),
    protocolVersion: sanitizeReportString(version?.['Protocol-Version'])
  };

  const pageTargets = Array.isArray(targets) ? targets.filter((target) => target?.type === 'page') : [];
  const exactTargets = pageTargets.filter((target) => isBenchmarkTarget(target, benchmarkUrl));
  const blockedTargets = pageTargets.filter((target) => isExternalBlockedTarget(target, benchmarkUrl));
  report.exactTargets = exactTargets.map(sanitizeGuardTarget);
  report.blockedTargets = blockedTargets.map(sanitizeGuardTarget);

  if (exactTargets.length !== 1) {
    return setReportReason(report, exactTargets.length === 0
      ? 'No exact local benchmark target is available for prompt handoff.'
      : `Found ${exactTargets.length} exact benchmark targets; prompt handoff is ambiguous.`);
  }

  if (blockedTargets.length > 0) {
    return setReportReason(report, `Found ${blockedTargets.length} external/search/sign-in target(s); prompt handoff is blocked.`);
  }

  if (options.requireRendererState !== false) {
    try {
      const rendererEndpointValue = await resolveRendererCdpEndpoint(options, cdpUrl);
      const rendererCdpUrl = normalizeCdpEndpoint(rendererEndpointValue, {
        allowRemoteCdp: Boolean(options.allowRemoteCdp)
      });
      const live = await readUitarsRendererStateFromCdp({
        cdpUrl: rendererCdpUrl.href,
        allowRemoteCdp: Boolean(options.allowRemoteCdp),
        timeoutMs: options.timeoutMs
      });
      report.rendererState = {
        available: true,
        cdp: {
          endpoint: sanitizeReportString(sanitizeUrl(rendererCdpUrl.href))
        },
        targetTitle: sanitizeReportString(live.targetTitle),
        targetUrl: sanitizeReportString(sanitizeUrl(live.targetUrl || ''))
      };
    } catch {
      report.rendererState = { available: false };
      return setReportReason(report, 'UI-TARS renderer state is unavailable.');
    }
  }

  report.verdict = 'safe_to_prompt';
  setReportReason(report, 'Exactly one local benchmark target is available and no blocked external targets are present.');
  return report;
}
