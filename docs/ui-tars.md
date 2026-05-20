# UI-TARS Notes

## Config

Local config discovery is handled by:

```sh
node scripts/check-local.mjs
```

Set `UI_TARS_CONFIG` to the exact config path, or provide several paths with
`UI_TARS_CONFIG_PATHS`. The check only verifies readability and never prints
secret-bearing file contents.

## Tunnel

The default model endpoint assumes a local SSH tunnel:

```text
http://127.0.0.1:18001/v1/models
```

Verify it with:

```sh
node scripts/check-tunnel.mjs
```

Override the URL with `TUNNEL_MODELS_URL` when the tunnel binds a different
local port.

## Remote Scope

Remote operations for this benchmark are limited to read-only health checks.
The expected remote project path is:

```text
/mnt/data/minghongsun/ui-tars-vllm
```

Do not inspect, modify, kill processes for, or write into colleague directories.
The check script refuses a remote root outside `/mnt/data/minghongsun/*`.

When starting vLLM manually outside this benchmark, use:

```sh
start_vllm_cu12.sh
```

Do not use the old `start_vllm.sh`.

