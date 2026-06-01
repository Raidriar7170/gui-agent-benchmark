#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  fetchJson,
  makeCdpUrl,
  normalizeCdpEndpoint,
  sanitizeTarget,
  sanitizeUrl
} from '../src/uitars-preflight.mjs';
import {
  readUitarsRendererStateFromCdp
} from '../src/uitars-native-transcript-export.mjs';

const INSPECT_SCHEMA_VERSION = 1;
const SENSITIVE_KEY_PATTERN = /(?:webSocketDebuggerUrl|api[_-]?key|apiKey|passwd|password|token|authorization|cookie|headers?|localstorage|screenshot|base64)/gi;
const SENSITIVE_KEY_VALUE_PATTERN = new RegExp(
  String.raw`\b(?:webSocketDebuggerUrl|api[_-]?key|apiKey|passwd|password|token|authorization|cookie|headers?|localstorage|screenshot|base64)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}|\[[^\]]*\]|[^\s,;]+)`,
  'gi'
);
const PRIVATE_IPV4_PATTERN = /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})\b/g;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>\\]+/gi;
const RAW_WEBSOCKET_URL_PATTERN = /\bwss?:\/\/[^\s"'<>\\]+/gi;
const HOSTNAME_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;

function usage() {
  return `Usage:
  node scripts/uitars-renderer-state-inspect.mjs --cdp-url <url> [options]

Options:
  --cdp-url <url>              Local CDP endpoint to inspect.
  --output <path>              Write sanitized inspection report.
  --allow-remote-cdp           Allow non-localhost CDP endpoint.
  --help                       Show this help.

Environment:
  UI_TARS_RENDERER_CDP_URL     Renderer CDP endpoint when --cdp-url is omitted.
`;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    cdpUrl: process.env.UI_TARS_RENDERER_CDP_URL || '',
    output: '',
    allowRemoteCdp: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--cdp-url') {
      options.cdpUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--cdp-url=')) options.cdpUrl = arg.slice('--cdp-url='.length);
    else if (arg === '--output') {
      options.output = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length);
    else if (arg === '--allow-remote-cdp') options.allowRemoteCdp = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.cdpUrl) {
    throw new Error('--cdp-url or UI_TARS_RENDERER_CDP_URL is required.');
  }
  return options;
}

function isLocalHostname(hostname) {
  return LOCAL_HOSTNAMES.has(String(hostname || '').toLowerCase());
}

function strictSanitizeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!isLocalHostname(url.hostname)) return '[redacted-url]';
    return sanitizeUrl(url.href);
  } catch {
    return '[redacted-url]';
  }
}

function strictSanitizeIp(value) {
  return value === '127.0.0.1' ? value : '[redacted-ip]';
}

function strictSanitizeHostname(value) {
  return isLocalHostname(value) ? value : '[redacted-host]';
}

function strictSanitizeString(value) {
  const text = String(value || '');
  if (/^data:image\/[^;]+;base64,/i.test(text) || /^[A-Za-z0-9+/=]{400,}$/.test(text)) {
    return '[redacted]';
  }
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1')
    .replace(RAW_WEBSOCKET_URL_PATTERN, '[redacted-url]')
    .replace(HTTP_URL_PATTERN, strictSanitizeHttpUrl)
    .replace(PRIVATE_IPV4_PATTERN, '[redacted-ip]')
    .replace(IPV4_PATTERN, strictSanitizeIp)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted]')
    .replace(/\bBearer\b/gi, '[redacted]')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, '[redacted]')
    .replace(SENSITIVE_KEY_VALUE_PATTERN, '[redacted]')
    .replace(SENSITIVE_KEY_PATTERN, '[redacted]')
    .replace(HOSTNAME_PATTERN, strictSanitizeHostname);
}

function strictSanitizeUrl(value) {
  return strictSanitizeString(sanitizeUrl(value));
}

function strictSanitizeTarget(target) {
  const sanitized = sanitizeTarget(target);
  return {
    id: strictSanitizeString(sanitized.id),
    type: strictSanitizeString(sanitized.type),
    title: strictSanitizeString(sanitized.title),
    url: strictSanitizeUrl(sanitized.url)
  };
}

function sanitizedError(error) {
  return strictSanitizeString(error instanceof Error ? error.message : error);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }

  const endpoint = normalizeCdpEndpoint(options.cdpUrl, {
    allowRemoteCdp: options.allowRemoteCdp
  });
  const targets = await fetchJson(makeCdpUrl(endpoint, '/json/list'));
  const report = {
    schemaVersion: INSPECT_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    cdp: {
      endpoint: strictSanitizeUrl(endpoint.href)
    },
    targets: Array.isArray(targets) ? targets.map(strictSanitizeTarget) : [],
    rendererState: {
      available: false
    }
  };

  try {
    const live = await readUitarsRendererStateFromCdp({
      cdpUrl: endpoint.href,
      allowRemoteCdp: options.allowRemoteCdp
    });
    report.rendererState = {
      available: true,
      source: strictSanitizeString(live.state?.source),
      messageCount: Array.isArray(live.state?.messages) ? live.state.messages.length : 0,
      targetTitle: strictSanitizeString(live.targetTitle),
      targetUrl: strictSanitizeUrl(live.targetUrl || '')
    };
  } catch (error) {
    report.rendererState.error = sanitizedError(error);
  }

  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, body, 'utf8');
  }
  process.stdout.write(body);
  if (!report.rendererState.available) process.exitCode = 1;
} catch (error) {
  console.error(sanitizedError(error));
  process.exitCode = 1;
}
