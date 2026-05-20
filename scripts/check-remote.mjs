#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2));
  return filePath;
}

function sshTarget(user, host) {
  return user ? `${user}@${host}` : host;
}

function runSsh(args, input) {
  return new Promise((resolve) => {
    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(input);
  });
}

const host = process.env.UI_TARS_REMOTE_HOST || '127.0.0.1';
const port = process.env.UI_TARS_REMOTE_PORT || '22';
const user = process.env.UI_TARS_REMOTE_USER || userInfo().username;
const keyPath = expandHome(process.env.UI_TARS_REMOTE_KEY || '');
const remoteRoot = process.env.UI_TARS_REMOTE_ROOT || '/mnt/data/minghongsun/ui-tars-vllm';
const timeout = process.env.UI_TARS_REMOTE_CONNECT_TIMEOUT || '8';
const tailLines = process.env.UI_TARS_REMOTE_TAIL_LINES || '80';

const sshArgs = [
  '-o', 'BatchMode=yes',
  '-o', `ConnectTimeout=${timeout}`,
  '-p', port
];

if (keyPath) {
  if (!existsSync(keyPath)) {
    console.error(`Remote health check failed: key path does not exist: ${keyPath}`);
    process.exit(1);
  }
  sshArgs.push('-i', keyPath);
}

sshArgs.push(sshTarget(user, host), 'sh', '-s', '--', remoteRoot, tailLines);

const remoteScript = String.raw`
ROOT="$1"
TAIL_LINES="$2"
STATUS=0

echo "== remote root =="
echo "$ROOT"
ALLOWED_ROOT="/mnt/data/minghongsun"
CANONICAL_ROOT=""
SAFE_ROOT=""

if [ -d "$ROOT" ]; then
  CANONICAL_ROOT=$(cd -P "$ROOT" 2>/dev/null && pwd -P)
fi

if [ -n "$CANONICAL_ROOT" ]; then
  echo "canonical: $CANONICAL_ROOT"
fi

case "$CANONICAL_ROOT" in
  "$ALLOWED_ROOT"|"$ALLOWED_ROOT"/*)
    SAFE_ROOT="$CANONICAL_ROOT"
    ;;
  *)
    echo "error: remote root must resolve under /mnt/data/minghongsun"
    STATUS=1
    ;;
esac

if [ -n "$SAFE_ROOT" ] && [ -d "$SAFE_ROOT" ]; then
  echo "ok: project directory exists"
  START_SCRIPT=""
  for candidate in "$SAFE_ROOT/scripts/start_vllm_cu12.sh" "$SAFE_ROOT/start_vllm_cu12.sh"; do
    if [ -f "$candidate" ]; then
      START_SCRIPT="$candidate"
      break
    fi
  done
  if [ -n "$START_SCRIPT" ]; then
    echo "ok: start_vllm_cu12.sh exists at $START_SCRIPT"
  else
    echo "warning: start_vllm_cu12.sh not found"
  fi
  for old_candidate in "$SAFE_ROOT/scripts/start_vllm.sh" "$SAFE_ROOT/start_vllm.sh"; do
    if [ -f "$old_candidate" ]; then
      echo "warning: old start_vllm.sh is present at $old_candidate; use start_vllm_cu12.sh instead"
      break
    fi
  done
else
  echo "error: project directory is missing"
  STATUS=1
fi

echo
echo "== listening ports 8000/8001 =="
PORT_LINES=""
if command -v ss >/dev/null 2>&1; then
  PORT_LINES=$(ss -ltn 2>/dev/null | awk '$4 ~ /(^|:|\]:)(8000|8001)$/ {print}')
elif command -v netstat >/dev/null 2>&1; then
  PORT_LINES=$(netstat -ltn 2>/dev/null | awk '$4 ~ /(^|:|\]:)(8000|8001)$/ {print}')
else
  echo "error: neither ss nor netstat is available"
  STATUS=1
fi

if [ -n "$PORT_LINES" ]; then
  printf '%s\n' "$PORT_LINES"
else
  echo "error: no listeners found on 8000 or 8001"
  STATUS=1
fi

echo
echo "== gpu summary =="
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits
else
  echo "error: nvidia-smi is not available"
  STATUS=1
fi

echo
echo "== proxy/vLLM log tails =="
FOUND_LOG=0
if [ -n "$SAFE_ROOT" ]; then
  for file in "$SAFE_ROOT"/logs/*proxy*.log "$SAFE_ROOT"/logs/*vllm*.log "$SAFE_ROOT"/*proxy*.log "$SAFE_ROOT"/*vllm*.log "$SAFE_ROOT"/*.log; do
    if [ -f "$file" ]; then
      case "$file" in
        *proxy*|*vllm*|*VLLM*|*server*)
          FOUND_LOG=1
          echo "-- tail: $file"
          tail -n "$TAIL_LINES" "$file"
          ;;
      esac
    fi
  done
fi

if [ "$FOUND_LOG" -eq 0 ]; then
  if [ -n "$SAFE_ROOT" ]; then
    LOG_ROOT="$SAFE_ROOT"
  else
    LOG_ROOT="$ROOT"
  fi
  echo "warning: no matching proxy/vLLM logs found under $LOG_ROOT"
fi

exit "$STATUS"
`;

console.log(`Running read-only remote health check on ${sshTarget(user, host)}:${port}`);
console.log(`Remote root: ${remoteRoot}`);
const result = await runSsh(sshArgs, remoteScript);

if (result.stdout.trim()) {
  console.log(result.stdout.trimEnd());
}
if (result.stderr.trim()) {
  console.error(result.stderr.trimEnd());
}

if (result.code !== 0) {
  console.error(`Remote health check failed with exit code ${result.code}.`);
  process.exit(result.code || 1);
}

console.log('Remote health check passed.');
