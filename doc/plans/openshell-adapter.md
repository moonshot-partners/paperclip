# OpenShell Adapter & Plugin System — Design Document

> Status: Draft
> Author: Ricardo Rodriguez (Moonshot Partners)
> Date: 2026-03-25
> Tracks: moonshot-partners/paperclip-infra#10, #11, #12

## Problem

Paperclip agents on OpenClaw gateways have limited capabilities — no bash, no file access, no native MCP. Tools are mediated through custom JavaScript plugins with explicit allowlists. This creates:

1. **Capability constraints** — agents can't run scripts, read files, or use git
2. **Maintenance burden** — each tool requires a custom OpenClaw plugin + mcporter hacks for MCP
3. **Security model mismatch** — tool allowlists are application-layer; container boundaries are stronger
4. **Vendor lock-in** — all agents must go through OpenClaw, even when simpler options exist

## Solution

Run agents inside [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) sandboxes — isolated containers with declarative security policies. Agents get full Claude Code capabilities (bash, MCP, files) while policies enforce network/filesystem/process boundaries at the container level.

This requires two changes to Paperclip:
1. **Dynamic adapter plugin system** — so the OpenShell adapter can be installed without forking
2. **OpenShell sandbox adapter** — manages sandbox lifecycle and runs Claude Code inside it

## Architecture

```
                     Paperclip Server
                           │
                    ┌──────┴──────┐
                    │  Heartbeat  │
                    │   Engine    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
        claude_local   openclaw_gw    openshell_claude
        (direct CLI)   (WebSocket)    (gRPC via openshell-node)
              │            │                │
              ▼            ▼                ▼
         Claude Code   OpenClaw       OpenShell Gateway
         (on host)     Container      (K3s control plane)
                                           │
                                    ┌──────┴──────┐
                                    │   Sandbox   │
                                    │  Container  │
                                    │             │
                                    │ Claude Code │
                                    │ + MCP       │
                                    │ + bash      │
                                    │ + files     │
                                    │             │
                                    │ ┌─────────┐ │
                                    │ │ Policies│ │
                                    │ │ network │ │
                                    │ │ fs      │ │
                                    │ │ process │ │
                                    │ └─────────┘ │
                                    └─────────────┘
```

## Adapter execute() sequence

```
Paperclip                    Adapter                    OpenShell Gateway
   │                            │                            │
   │  execute(context)          │                            │
   ├───────────────────────────►│                            │
   │                            │  createSandbox(spec)       │
   │                            ├───────────────────────────►│
   │                            │          sandbox           │
   │                            │◄───────────────────────────┤
   │                            │                            │
   │                            │  waitReady(name)           │
   │                            ├───────────────────────────►│
   │                            │          READY             │
   │                            │◄───────────────────────────┤
   │                            │                            │
   │                            │  execSandbox(claude ...)   │
   │                            ├───────────────────────────►│
   │                            │                            │
   │                            │   stream: stdout lines     │
   │  onLog("stdout", line)     │◄ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
   │◄───────────────────────────┤                            │
   │                            │   stream: exit(code)       │
   │                            │◄ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
   │                            │                            │
   │                            │  deleteSandbox(name)       │
   │                            ├───────────────────────────►│
   │                            │                            │
   │  AdapterExecutionResult    │                            │
   │◄───────────────────────────┤                            │
```

## Security model comparison

| Aspect | OpenClaw | OpenShell |
|--------|----------|-----------|
| **Tool access** | Explicit allowlist (`tools.allow` in openclaw.json) | Full Claude Code tools — bash, files, MCP |
| **Network** | Docker network isolation (can be bypassed) | Policy-enforced egress proxy (per-host, per-port, L7 rules) |
| **Filesystem** | No agent file access | Landlock-enforced read/write paths |
| **Credentials** | Plaintext in mounted config files | Env var injection, never on disk |
| **Process** | No restrictions within container | Syscall filtering, privilege escalation prevention |
| **Policy updates** | Restart container | Hot-reload (network, inference) |
| **MCP servers** | Via mcporter (hack) | Native Claude Code MCP support |

## Config schema

### Adapter config (per-agent in Paperclip)

```json
{
  "gatewayUrl": "localhost:8080",
  "gatewayCluster": "openshell",
  "sandboxImage": "ghcr.io/nvidia/openshell/sandbox:latest",
  "persistSandbox": false,
  "model": "claude-opus-4-6",
  "maxTurnsPerRun": 300,
  "timeoutSec": 3600,
  "sandboxTimeoutSec": 60,
  "policy": {
    "network": {
      "claude_api": {
        "endpoints": [{ "host": "api.anthropic.com", "ports": [443] }]
      },
      "slack": {
        "endpoints": [{ "host": "api.slack.com", "ports": [443] }]
      }
    },
    "filesystem": {
      "readOnly": ["/workspace/knowledge"],
      "readWrite": ["/workspace/outputs"]
    }
  },
  "providers": ["claude-api-key"],
  "env": {
    "PAPERCLIP_API_URL": "http://server:3100/api"
  }
}
```

### Plugin system config (in paperclip config file)

```json
{
  "externalAdapters": [
    "@paperclipai/adapter-openshell-claude"
  ]
}
```

## Sandbox lifecycle

### Ephemeral (default)

One sandbox per task execution. Created at start, destroyed at end. Clean slate every time.

```
Task assigned → create sandbox → run claude → capture output → destroy sandbox
```

### Persistent (opt-in)

Sandbox persists across heartbeats for the same session. Named `paperclip-{agentId}-{sessionKey}`.

```
First heartbeat → create sandbox → run claude → keep alive
Next heartbeat  → reuse sandbox → resume session → keep alive
Task complete   → destroy sandbox
```

## Dependencies

- **openshell-node** (`moonshot-partners/openshell-node`) — TypeScript gRPC client for OpenShell
- **@paperclipai/adapter-utils** — shared adapter types and utilities
- Claude Code's `--output-format stream-json` — same parsing as `claude_local` adapter

## Migration from OpenClaw

For existing companies (e.g. TPC):

1. Install OpenShell on the server
2. Create company policy (replace `openclaw.json` tool allowlists)
3. Set up MCP servers to replace OpenClaw plugins
4. Change agent `adapterType` from `openclaw_gateway` to `openshell_claude`
5. Update `adapterConfig` with OpenShell gateway URL and policy
6. Test with one agent first, then migrate all

OpenClaw gateway containers can continue running during migration — both adapters coexist.
