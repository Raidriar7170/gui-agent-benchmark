#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

import {
  DEFAULT_TUNNEL_COMPATIBILITY_MAX_TOKENS,
  checkTunnelHealth
} from '../src/tunnel-health.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function serverUrl(server, path = '/v1/models') {
  return `http://127.0.0.1:${server.address().port}${path}`;
}

async function withServer(handler, callback) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: request.method, url: request.url, body });
      try {
        await handler({ request, response, body });
      } catch (error) {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await callback({ server, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function writeJson(response, statusCode, value) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(value));
}

async function runCli(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/check-tunnel.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

await withServer(({ request, response, body }) => {
  if (request.url === '/v1/models') {
    writeJson(response, 200, { data: [{ id: 'ByteDance-Seed/UI-TARS-1.5-7B' }] });
    return;
  }
  if (request.url === '/v1/chat/completions') {
    const payload = JSON.parse(body);
    assert(payload.model === 'ByteDance-Seed/UI-TARS-1.5-7B', 'compatibility check should use the reported model id');
    assert(payload.max_tokens === DEFAULT_TUNNEL_COMPATIBILITY_MAX_TOKENS, 'compatibility check should exercise UI-TARS max_tokens behavior');
    assert(payload.stream === false, 'compatibility check should mirror UI-TARS non-stream chat requests');
    assert(Array.isArray(payload.stop), 'compatibility check should include a short stop sequence');
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    response.end('{"choices":[{"message":{"content":"OK"}}]}');
    return;
  }
  writeJson(response, 404, { error: 'not found' });
}, async ({ server, requests }) => {
  const report = await checkTunnelHealth({
    modelsUrl: serverUrl(server),
    timeoutMs: 1000
  });
  assert(report.status === 'passed', 'healthy tunnel should pass');
  assert(report.modelCount === 1, 'healthy tunnel should report model count');
  assert(report.compatibility.status === 'passed', 'healthy tunnel should pass chat compatibility');
  assert(requests.some((entry) => entry.url === '/v1/chat/completions'), 'health check should call chat completions');
});

await withServer(({ request, response }) => {
  if (request.url === '/v1/models') {
    writeJson(response, 200, { data: [{ id: 'ByteDance-Seed/UI-TARS-1.5-7B' }] });
    return;
  }
  if (request.url === '/v1/chat/completions') {
    writeJson(response, 400, {
      error: {
        message: 'maximum context length is 16384 tokens. However, you requested 65970 tokens.'
      }
    });
    return;
  }
  writeJson(response, 404, { error: 'not found' });
}, async ({ server }) => {
  let failed = false;
  try {
    await checkTunnelHealth({ modelsUrl: serverUrl(server), timeoutMs: 1000 });
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes('8001'), 'direct vLLM context failure should mention the proxy port');
    assert(message.includes('8000'), 'direct vLLM context failure should mention the direct vLLM port');
    assert(message.includes('maximum context length'), 'direct vLLM context failure should preserve the server detail');
  }
  assert(failed, 'direct vLLM context failure should fail the tunnel health check');
});

await withServer(({ request, response }) => {
  if (request.url === '/v1/models') {
    writeJson(response, 200, { data: [{ id: 'only-model' }] });
    return;
  }
  writeJson(response, 500, { error: 'chat should not be called' });
}, async ({ server, requests }) => {
  const report = await checkTunnelHealth({
    modelsUrl: serverUrl(server),
    skipCompatibility: true,
    timeoutMs: 1000
  });
  assert(report.compatibility.status === 'skipped', 'skipCompatibility should skip chat compatibility');
  assert(!requests.some((entry) => entry.url === '/v1/chat/completions'), 'skipCompatibility should not call chat completions');
});

await withServer(({ response }) => {
  writeJson(response, 200, { object: 'list' });
}, async ({ server }) => {
  let failed = false;
  try {
    await checkTunnelHealth({ modelsUrl: serverUrl(server), skipCompatibility: true, timeoutMs: 1000 });
  } catch (error) {
    failed = true;
    assert(String(error.message).includes('data array'), 'invalid models response should explain the expected schema');
  }
  assert(failed, 'invalid models response should fail');
});

await withServer(({ request, response }) => {
  if (request.url === '/v1/models') {
    writeJson(response, 200, { data: [{ id: 'cli-model' }] });
    return;
  }
  if (request.url === '/v1/chat/completions') {
    response.statusCode = 200;
    response.end('{"choices":[{"message":{"content":"OK"}}]}');
    return;
  }
  writeJson(response, 404, { error: 'not found' });
}, async ({ server }) => {
  const result = await runCli({
    TUNNEL_MODELS_URL: serverUrl(server),
    TUNNEL_TIMEOUT_MS: '1000'
  });
  assert(result.exitCode === 0, 'CLI should pass for a healthy synthetic tunnel');
  assert(result.stdout.includes('Chat compatibility: passed'), 'CLI output should include chat compatibility status');
});

if (errors.length > 0) {
  console.error('Tunnel health validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Tunnel health validation passed.');
