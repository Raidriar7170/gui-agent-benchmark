#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';

const modelsUrl = process.env.TUNNEL_MODELS_URL || 'http://127.0.0.1:18001/v1/models';
const timeoutMs = Number(process.env.TUNNEL_TIMEOUT_MS || 3000);

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, { timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ statusCode: response.statusCode || 0, body });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
  });
}

try {
  console.log(`Checking tunnel models endpoint: ${modelsUrl}`);
  const { statusCode, body } = await requestJson(modelsUrl);
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode}: ${body.slice(0, 300)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Endpoint returned non-JSON response: ${body.slice(0, 120)}`);
  }

  if (!Array.isArray(parsed.data)) {
    throw new Error('Endpoint JSON must include a data array.');
  }

  const modelCount = parsed.data.length;
  console.log(`Tunnel health check passed. Models reported: ${modelCount}.`);
} catch (error) {
  console.error('Tunnel health check failed.');
  console.error(`- ${error.message}`);
  console.error('The rest of the local benchmark can still be validated without the tunnel.');
  process.exit(1);
}
