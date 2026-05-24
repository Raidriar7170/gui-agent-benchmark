#!/usr/bin/env node
import {
  DEFAULT_TUNNEL_MODELS_URL,
  DEFAULT_TUNNEL_TIMEOUT_MS,
  checkTunnelHealth
} from '../src/tunnel-health.mjs';

const modelsUrl = process.env.TUNNEL_MODELS_URL || DEFAULT_TUNNEL_MODELS_URL;
const chatUrl = process.env.TUNNEL_CHAT_URL || '';
const model = process.env.TUNNEL_MODEL || '';
const timeoutMs = Number(process.env.TUNNEL_TIMEOUT_MS || DEFAULT_TUNNEL_TIMEOUT_MS);
const maxTokens = process.env.TUNNEL_COMPATIBILITY_MAX_TOKENS
  ? Number(process.env.TUNNEL_COMPATIBILITY_MAX_TOKENS)
  : undefined;
const skipCompatibility = process.env.TUNNEL_SKIP_COMPATIBILITY === '1';

try {
  console.log(`Checking tunnel models endpoint: ${modelsUrl}`);
  if (!skipCompatibility) {
    console.log('Checking UI-TARS chat compatibility with a non-stream high max_tokens probe.');
  }

  const report = await checkTunnelHealth({
    modelsUrl,
    chatUrl,
    model,
    timeoutMs,
    maxTokens,
    skipCompatibility
  });

  console.log(`Tunnel health check passed. Models reported: ${report.modelCount}.`);
  console.log(`Chat compatibility: ${report.compatibility.status}.`);
  if (report.compatibility.status === 'passed') {
    console.log(`Compatibility model: ${report.compatibility.model}.`);
  }
} catch (error) {
  console.error('Tunnel health check failed.');
  console.error(`- ${error.message}`);
  console.error('For the Volcano UI-TARS deployment, bind the local tunnel to remote proxy port 8001, not direct vLLM port 8000.');
  console.error('Example: ssh -L 18001:127.0.0.1:8001 <remote-host>');
  console.error('The rest of the local benchmark can still be validated without the tunnel.');
  process.exit(1);
}
