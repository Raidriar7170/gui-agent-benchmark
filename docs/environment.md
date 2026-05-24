# Environment

This project has no npm dependencies. Use Node 18 or newer.

## Local Checks

```sh
node scripts/check-local.mjs
```

The local check reports:

- Node version.
- Python version, using `PYTHON_BIN`, `python3`, then `python`.
- Git version.
- Readable UI-TARS config file candidates.

UI-TARS config candidates can be configured with:

- `UI_TARS_CONFIG=/path/to/config.json`
- `UI_TARS_CONFIG_PATHS=/path/a.json:/path/b.json`
- `UI_TARS_CONFIG_REQUIRED=1` to fail when no config file is found.

The script only checks whether config files are readable. It does not print file
contents, API keys, tokens, or passwords.

## Local SSH Tunnel

```sh
node scripts/check-tunnel.mjs
```

Default endpoint:

```text
http://127.0.0.1:18001/v1/models
```

For the Volcano UI-TARS deployment, bind the local port to the remote proxy:

```sh
ssh -L 18001:127.0.0.1:8001 <remote-host>
```

Do not bind `18001` to remote `8000` for UI-TARS. Port `8000` is the direct
vLLM server; it can pass `/v1/models` but fail UI-TARS chat requests with a
context-length error because UI-TARS sends high `max_tokens`. Port `8001` is the
guard proxy used by this project.

Override with:

- `TUNNEL_MODELS_URL`
- `TUNNEL_CHAT_URL`
- `TUNNEL_MODEL`
- `TUNNEL_TIMEOUT_MS`
- `TUNNEL_COMPATIBILITY_MAX_TOKENS`
- `TUNNEL_SKIP_COMPATIBILITY=1` to skip the chat probe and check only
  `/v1/models`

If the tunnel is unavailable or points at the direct vLLM port, the script exits
with a clear failure message. The benchmark UI and task validation can still be
run without a live tunnel.

## Remote Read-Only Check

```sh
UI_TARS_REMOTE_HOST=your-host \
UI_TARS_REMOTE_PORT=22 \
UI_TARS_REMOTE_USER=your-user \
UI_TARS_REMOTE_KEY=~/.ssh/your_key \
node scripts/check-remote.mjs
```

Supported variables:

- `UI_TARS_REMOTE_HOST` default `127.0.0.1`
- `UI_TARS_REMOTE_PORT` default `22`
- `UI_TARS_REMOTE_USER` default current local user
- `UI_TARS_REMOTE_KEY` optional SSH key path
- `UI_TARS_REMOTE_ROOT` default `/mnt/data/minghongsun/ui-tars-vllm`
- `UI_TARS_REMOTE_CONNECT_TIMEOUT` default `8`
- `UI_TARS_REMOTE_TAIL_LINES` default `80`

The remote check is read-only. It checks:

- `/mnt/data/minghongsun/ui-tars-vllm`
- listeners on ports `8000` and `8001`
- GPU summary via `nvidia-smi`
- proxy/vLLM log tails under the project directory

Remote work must stay under `/mnt/data/minghongsun`. Do not touch colleague
directories. For vLLM startup, use `start_vllm_cu12.sh`; do not use the older
`start_vllm.sh`.
