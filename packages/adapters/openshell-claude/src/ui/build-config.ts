import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export function buildOpenShellClaudeConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.url) ac.gatewayUrl = v.url;
  ac.timeoutSec = 3600;
  ac.sandboxTimeoutSec = 120;
  ac.dangerouslySkipPermissions = true;
  return ac;
}
