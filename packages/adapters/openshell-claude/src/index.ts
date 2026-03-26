export const type = "openshell_claude";
export const label = "OpenShell Claude";

export const models: { id: string; label: string }[] = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export const agentConfigurationDoc = `# openshell_claude agent configuration

Adapter: openshell_claude

Runs Claude Code inside an NVIDIA OpenShell sandbox with declarative security policies.
Agents get full Claude Code capabilities (bash, MCP, files) while network/filesystem/process
policies enforce container-level isolation.

Core fields:
- gatewayUrl (string, required): OpenShell gateway gRPC endpoint (e.g. "127.0.0.1:8080")
- gatewayCluster (string, optional): mTLS cert lookup name (default "openshell")
- insecure (boolean, optional): skip TLS for local dev (default false)

Sandbox fields:
- sandboxImage (string, optional): container image for the sandbox
- persistSandbox (boolean, optional): keep sandbox alive between heartbeats (default false)
- providers (string[], optional): OpenShell provider names to attach (for credential injection)

Claude Code fields:
- model (string, optional): Claude model ID
- maxTurnsPerRun (number, optional): max turns per execution
- effort (string, optional): reasoning effort (low, medium, high)
- dangerouslySkipPermissions (boolean, optional): skip Claude Code permission prompts (default true in headless mode)

Timeout fields:
- sandboxTimeoutSec (number, optional): sandbox creation timeout (default 60)
- timeoutSec (number, optional): task execution timeout (default 3600)
- graceSec (number, optional): grace period before kill (default 30)

Environment fields:
- env (object, optional): extra environment variables injected into the sandbox
  - env.CLAUDE_CODE_OAUTH_TOKEN (string): Claude OAuth token (for team subscriptions)
  - env.ANTHROPIC_API_KEY (string): Anthropic API key (for direct API access)
  If neither is set in env, the adapter falls back to the server's environment variables.

Policy fields:
- policy (object, optional): OpenShell security policy applied at sandbox creation
  - policy.network (object, optional): named network policy rules with endpoint allowlists
  - policy.filesystem (object, optional): { readOnly: string[], readWrite: string[] }
`;
